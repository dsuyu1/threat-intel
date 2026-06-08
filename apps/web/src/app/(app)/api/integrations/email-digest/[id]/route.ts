export const runtime = "edge";

import { getDb, emailDigestConnections, type WebhookDeliveryCriteria } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeRecipients(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((x) => String(x))
    : typeof input === "string"
      ? input
          .split(/[,\n]/g)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const v = r.trim().toLowerCase();
    if (!v) continue;
    if (!isEmail(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.slice(0, 50);
}

function normalizeFrequency(input: unknown): "daily" | "weekly" {
  return String(input ?? "").trim() === "weekly" ? "weekly" : "daily";
}

function normalizeSendHour(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return 8;
  const hour = Math.floor(n);
  return Math.max(0, Math.min(23, hour));
}

function normalizeTimezone(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s) return "UTC";
  return s.slice(0, 64);
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
  const viewer = await getViewerContext();
  const body = (await req.json().catch(() => null)) as any;

  const patch: Record<string, any> = { updatedAt: new Date() };
  if (body?.name != null) patch.name = String(body.name).trim();
  if (body?.enabled != null) patch.enabled = Boolean(body.enabled);
  if (body?.recipients != null) patch.recipients = normalizeRecipients(body.recipients);
  if (body?.frequency != null) patch.frequency = normalizeFrequency(body.frequency);
  if (body?.sendHour != null) patch.sendHour = normalizeSendHour(body.sendHour);
  if (body?.timezone != null) patch.timezone = normalizeTimezone(body.timezone);
  if (body?.criteria != null) patch.criteria = normalizeCriteria(body.criteria);

  if (patch.name === "") return json({ error: "name is required" }, { status: 400 });
  if (Array.isArray(patch.recipients) && patch.recipients.length === 0) {
    return json({ error: "recipients must be a non-empty list of emails" }, { status: 400 });
  }

  let row:
    | {
        id: string;
        name: string;
        enabled: boolean;
        recipients: string[];
        frequency: string;
        sendHour: number;
        timezone: string;
        criteria: WebhookDeliveryCriteria | null;
        lastSentAt: Date | null;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(emailDigestConnections)
      .set(patch)
      .where(
        and(
          eq(emailDigestConnections.id, id),
          eq(emailDigestConnections.projectId, viewer.project.id),
          eq(emailDigestConnections.userId, viewer.user.id)
        )
      )
      .returning({
        id: emailDigestConnections.id,
        name: emailDigestConnections.name,
        enabled: emailDigestConnections.enabled,
        recipients: emailDigestConnections.recipients,
        frequency: emailDigestConnections.frequency,
        sendHour: emailDigestConnections.sendHour,
        timezone: emailDigestConnections.timezone,
        criteria: emailDigestConnections.criteria,
        lastSentAt: emailDigestConnections.lastSentAt,
        updatedAt: emailDigestConnections.updatedAt,
        createdAt: emailDigestConnections.createdAt,
      });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Email digest tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, connection: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const viewer = await getViewerContext();

  let row: { id: string } | undefined;
  try {
    [row] = await db
      .delete(emailDigestConnections)
      .where(
        and(
          eq(emailDigestConnections.id, id),
          eq(emailDigestConnections.projectId, viewer.project.id),
          eq(emailDigestConnections.userId, viewer.user.id)
        )
      )
      .returning({ id: emailDigestConnections.id });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Email digest tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}

