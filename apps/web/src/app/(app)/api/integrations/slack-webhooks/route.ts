export const runtime = "edge";

import { getDb, slackWebhookConnections, type WebhookDeliveryCriteria } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../lib/tenancy";

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

export async function GET() {
  const db = getDb();
  const ctx = await getViewerContext();

  let rows: Array<{
    id: string;
    name: string;
    enabled: boolean;
    webhookUrl: string;
    criteria: WebhookDeliveryCriteria | null;
    updatedAt: Date;
    createdAt: Date;
  }> = [];

  try {
    rows = await db
      .select({
        id: slackWebhookConnections.id,
        name: slackWebhookConnections.name,
        enabled: slackWebhookConnections.enabled,
        webhookUrl: slackWebhookConnections.webhookUrl,
        criteria: slackWebhookConnections.criteria,
        updatedAt: slackWebhookConnections.updatedAt,
        createdAt: slackWebhookConnections.createdAt,
      })
      .from(slackWebhookConnections)
      .where(eq(slackWebhookConnections.projectId, ctx.project.id))
      .orderBy(desc(slackWebhookConnections.updatedAt), desc(slackWebhookConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Slack tables are missing. Run pnpm db:migrate." }, { status: 503 });
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

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!webhookUrl) return json({ error: "webhookUrl must be a valid http(s) URL" }, { status: 400 });

  try {
    const [row] = await db
      .insert(slackWebhookConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        enabled,
        webhookUrl,
        criteria,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: slackWebhookConnections.id,
        name: slackWebhookConnections.name,
        enabled: slackWebhookConnections.enabled,
        webhookUrl: slackWebhookConnections.webhookUrl,
        criteria: slackWebhookConnections.criteria,
        updatedAt: slackWebhookConnections.updatedAt,
        createdAt: slackWebhookConnections.createdAt,
      });
    return json({ ok: true, connection: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Slack tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create connection" }, { status: 400 });
  }
}
