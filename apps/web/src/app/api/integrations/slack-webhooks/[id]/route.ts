export const runtime = "edge";

import { getDb, slackWebhookConnections, type WebhookDeliveryCriteria } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getLocalUser } from "../../../../../lib/local-user";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function safeExternalHref(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeCriteria(input: unknown): WebhookDeliveryCriteria {
  const c = (input ?? {}) as any;
  const agents = toStringArray(c.agents);
  const severities = toStringArray(c.severities);
  const minCvss = toNumber(c.minCvss);
  const requireCve = toBool(c.requireCve);
  const requireKev = toBool(c.requireKev);
  const tagsAny = toStringArray(c.tagsAny);
  const tagsAll = toStringArray(c.tagsAll);

  const out: WebhookDeliveryCriteria = {};
  if (agents?.length) out.agents = agents;
  if (severities?.length) out.severities = severities;
  if (typeof minCvss === "number") out.minCvss = Math.max(0, Math.min(10, minCvss));
  if (typeof requireCve === "boolean") out.requireCve = requireCve;
  if (typeof requireKev === "boolean") out.requireKev = requireKev;
  if (tagsAny?.length) out.tagsAny = tagsAny;
  if (tagsAll?.length) out.tagsAll = tagsAll;
  return out;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const user = await getLocalUser();
  const body = (await req.json().catch(() => null)) as any;

  const patch: Record<string, any> = { updatedAt: new Date() };
  if (body?.name != null) patch.name = String(body.name).trim();
  if (body?.enabled != null) patch.enabled = Boolean(body.enabled);
  if (body?.webhookUrl != null) {
    const href = safeExternalHref(String(body.webhookUrl).trim());
    if (!href) return json({ error: "webhookUrl must be a valid http(s) URL" }, { status: 400 });
    patch.webhookUrl = href;
  }
  if (body?.criteria != null) patch.criteria = normalizeCriteria(body.criteria);

  if (patch.name === "") return json({ error: "name is required" }, { status: 400 });

  let row:
    | {
        id: string;
        name: string;
        enabled: boolean;
        webhookUrl: string;
        criteria: WebhookDeliveryCriteria | null;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(slackWebhookConnections)
      .set(patch)
      .where(and(eq(slackWebhookConnections.id, id), eq(slackWebhookConnections.userId, user.id)))
      .returning({
        id: slackWebhookConnections.id,
        name: slackWebhookConnections.name,
        enabled: slackWebhookConnections.enabled,
        webhookUrl: slackWebhookConnections.webhookUrl,
        criteria: slackWebhookConnections.criteria,
        updatedAt: slackWebhookConnections.updatedAt,
        createdAt: slackWebhookConnections.createdAt,
      });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Slack tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, connection: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const user = await getLocalUser();

  let row: { id: string } | undefined;
  try {
    [row] = await db
      .delete(slackWebhookConnections)
      .where(and(eq(slackWebhookConnections.id, id), eq(slackWebhookConnections.userId, user.id)))
      .returning({ id: slackWebhookConnections.id });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Slack tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}

