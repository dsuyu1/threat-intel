export const runtime = "edge";

import {
  getDb,
  soarWebhookConnections,
  type SoarWebhookHeaders,
  type WebhookDeliveryCriteria,
} from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";

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

function normalizeHeaders(input: unknown): SoarWebhookHeaders {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: SoarWebhookHeaders = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k ?? "").trim();
    if (!key) continue;
    if (!/^[A-Za-z0-9-]+$/.test(key)) continue;
    const value = String(v ?? "").trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

export async function GET() {
  const db = getDb();
  const ctx = await getViewerContext();

  let rows: Array<{
    id: string;
    name: string;
    enabled: boolean;
    webhookUrl: string;
    headers: SoarWebhookHeaders | null;
    criteria: WebhookDeliveryCriteria | null;
    updatedAt: Date;
    createdAt: Date;
  }> = [];

  try {
    rows = await db
      .select({
        id: soarWebhookConnections.id,
        name: soarWebhookConnections.name,
        enabled: soarWebhookConnections.enabled,
        webhookUrl: soarWebhookConnections.webhookUrl,
        headers: soarWebhookConnections.headers,
        criteria: soarWebhookConnections.criteria,
        updatedAt: soarWebhookConnections.updatedAt,
        createdAt: soarWebhookConnections.createdAt,
      })
      .from(soarWebhookConnections)
      .where(eq(soarWebhookConnections.projectId, ctx.project.id))
      .orderBy(desc(soarWebhookConnections.updatedAt), desc(soarWebhookConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "SOAR tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  return json({ data: rows });
}

export async function POST(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();
  const body = (await req.json().catch(() => null)) as any;

  const name = String(body?.name ?? "").trim();
  const webhookUrlRaw = String(body?.webhookUrl ?? "").trim();
  const webhookUrl = safeExternalHref(webhookUrlRaw);
  const enabled = body?.enabled == null ? true : Boolean(body.enabled);
  const criteria = normalizeCriteria(body?.criteria);
  const headers = normalizeHeaders(body?.headers);

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!webhookUrl) return json({ error: "webhookUrl must be a valid http(s) URL" }, { status: 400 });

  try {
    const [row] = await db
      .insert(soarWebhookConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        enabled,
        webhookUrl,
        headers,
        criteria,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: soarWebhookConnections.id,
        name: soarWebhookConnections.name,
        enabled: soarWebhookConnections.enabled,
        webhookUrl: soarWebhookConnections.webhookUrl,
        headers: soarWebhookConnections.headers,
        criteria: soarWebhookConnections.criteria,
        updatedAt: soarWebhookConnections.updatedAt,
        createdAt: soarWebhookConnections.createdAt,
      });
    return json({ ok: true, connection: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "SOAR tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create connection" }, { status: 400 });
  }
}
