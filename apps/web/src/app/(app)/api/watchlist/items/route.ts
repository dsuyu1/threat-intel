export const runtime = "edge";

import { discordWebhookConnections, getDb, kgAliases, slackWebhookConnections, soarWebhookConnections, watchlistItems } from "@ti/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function normalizeAlias(alias: string): string {
  return String(alias ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeKind(v: unknown): "cve" | "technique" | "actor" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "cve") return "cve";
  if (s === "technique" || s === "mitre") return "technique";
  if (s === "actor" || s === "threat-actor") return "actor";
  return null;
}

function normalizeChannel(v: unknown): "slack" | "discord" | "soar" | "email" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "slack") return "slack";
  if (s === "discord") return "discord";
  if (s === "soar" || s === "webhook") return "soar";
  if (s === "email") return "email";
  return null;
}

function normalizeValue(params: { kind: "cve" | "technique" | "actor"; value: unknown }) {
  const raw = String(params.value ?? "").trim();
  if (!raw) return null;
  if (params.kind === "cve") {
    const v = raw.toUpperCase();
    return /^CVE-\d{4}-\d{4,}$/.test(v) ? v : null;
  }
  if (params.kind === "technique") {
    const v = raw.toUpperCase();
    return /^T\d{4}(\.\d{3})?$/.test(v) ? v : null;
  }
  // actor: may be an ID (G#### / U-uuid) or a name alias (resolved server-side).
  return raw;
}

async function resolveActorIdByAlias(params: { db: ReturnType<typeof getDb>; actor: string }) {
  const aliasNorm = normalizeAlias(params.actor);
  if (!aliasNorm) return null;
  const [row] = await params.db
    .select({ entityId: kgAliases.entityId })
    .from(kgAliases)
    .where(and(eq(kgAliases.kind, "actor"), eq(kgAliases.aliasNorm, aliasNorm)))
    .limit(1);
  return row?.entityId ?? null;
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  try {
    const rows = await db
      .select({
        id: watchlistItems.id,
        enabled: watchlistItems.enabled,
        kind: watchlistItems.kind,
        value: watchlistItems.value,
        channel: watchlistItems.channel,
        connectionId: watchlistItems.connectionId,
        createdAt: watchlistItems.createdAt,
        updatedAt: watchlistItems.updatedAt,
      })
      .from(watchlistItems)
      .where(and(eq(watchlistItems.projectId, ctx.project.id), eq(watchlistItems.userId, ctx.user.id)))
      .orderBy(desc(watchlistItems.updatedAt), desc(watchlistItems.createdAt), asc(watchlistItems.id))
      .limit(500);

    return json({ data: rows });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Watchlist tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const kind = normalizeKind(body?.kind);
  const channel = normalizeChannel(body?.channel);
  if (!kind) return json({ error: "kind must be one of: cve, technique, actor" }, { status: 400 });
  if (!channel) return json({ error: "channel must be one of: slack, discord, soar, email" }, { status: 400 });

  const normalizedValue = normalizeValue({ kind, value: body?.value });
  if (!normalizedValue) {
    return json({ error: kind === "cve" ? "value must be a CVE-YYYY-NNNN" : kind === "technique" ? "value must be a T####(.###)" : "value is required" }, { status: 400 });
  }

  let value = normalizedValue;
  if (kind === "actor") {
    const trimmed = value.trim();
    const looksLikeId =
      /^G\d{4}$/.test(trimmed.toUpperCase()) || /^U-[0-9a-f-]{36}$/i.test(trimmed) || /^U-[0-9a-f]{8}/i.test(trimmed);
    if (!looksLikeId) {
      const resolved = await resolveActorIdByAlias({ db, actor: trimmed });
      if (!resolved) return json({ error: "Actor not found. Try the actor ID (e.g., G0046) or add it to the actor library first." }, { status: 400 });
      value = resolved;
    } else {
      value = trimmed.toUpperCase();
    }
  }

  const connectionIdRaw = body?.connectionId == null ? null : String(body.connectionId).trim();
  const connectionId = connectionIdRaw && isUuid(connectionIdRaw) ? connectionIdRaw : null;

  if (channel === "email") {
    if (connectionId) return json({ error: "connectionId must be null for email channel" }, { status: 400 });

    // Prevent duplicates for email items (NULL connection_id cannot be enforced by a plain unique index).
    const [existing] = await db
      .select({
        id: watchlistItems.id,
        enabled: watchlistItems.enabled,
        kind: watchlistItems.kind,
        value: watchlistItems.value,
        channel: watchlistItems.channel,
        connectionId: watchlistItems.connectionId,
        createdAt: watchlistItems.createdAt,
        updatedAt: watchlistItems.updatedAt,
      })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.projectId, ctx.project.id),
          eq(watchlistItems.userId, ctx.user.id),
          eq(watchlistItems.kind, kind as any),
          eq(watchlistItems.value, value),
          eq(watchlistItems.channel, "email" as any),
          isNull(watchlistItems.connectionId)
        )
      )
      .limit(1);
    if (existing) return json({ ok: true, item: existing, existed: true });
  } else {
    if (!connectionId) return json({ error: "connectionId is required for slack/discord/soar channels" }, { status: 400 });

    // Validate that the connection belongs to this user + project.
    const ok = await (async () => {
      if (channel === "slack") {
        const [row] = await db
          .select({ id: slackWebhookConnections.id })
          .from(slackWebhookConnections)
          .where(and(eq(slackWebhookConnections.id, connectionId), eq(slackWebhookConnections.projectId, ctx.project.id), eq(slackWebhookConnections.userId, ctx.user.id)))
          .limit(1);
        return !!row?.id;
      }
      if (channel === "discord") {
        const [row] = await db
          .select({ id: discordWebhookConnections.id })
          .from(discordWebhookConnections)
          .where(and(eq(discordWebhookConnections.id, connectionId), eq(discordWebhookConnections.projectId, ctx.project.id), eq(discordWebhookConnections.userId, ctx.user.id)))
          .limit(1);
        return !!row?.id;
      }
      const [row] = await db
        .select({ id: soarWebhookConnections.id })
        .from(soarWebhookConnections)
        .where(and(eq(soarWebhookConnections.id, connectionId), eq(soarWebhookConnections.projectId, ctx.project.id), eq(soarWebhookConnections.userId, ctx.user.id)))
        .limit(1);
      return !!row?.id;
    })();

    if (!ok) return json({ error: "Connection not found for this project/user" }, { status: 404 });
  }

  try {
    const now = new Date();
    const [row] = await db
      .insert(watchlistItems)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        enabled: true,
        kind: kind as any,
        value,
        channel: channel as any,
        connectionId: connectionId ?? undefined,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: watchlistItems.id,
        enabled: watchlistItems.enabled,
        kind: watchlistItems.kind,
        value: watchlistItems.value,
        channel: watchlistItems.channel,
        connectionId: watchlistItems.connectionId,
        createdAt: watchlistItems.createdAt,
        updatedAt: watchlistItems.updatedAt,
      });

    return json({ ok: true, item: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Watchlist tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create item" }, { status: 400 });
  }
}
