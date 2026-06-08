export const runtime = "edge";

import { getDb, thehiveConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { encryptSecret } from "../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function normalizeBaseUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${pathname}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  let rows: Array<{
    id: string;
    name: string;
    enabled: boolean;
    baseUrl: string;
    authScheme: string;
    lastSyncedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }> = [];

  try {
    rows = await db
      .select({
        id: thehiveConnections.id,
        name: thehiveConnections.name,
        enabled: thehiveConnections.enabled,
        baseUrl: thehiveConnections.baseUrl,
        authScheme: thehiveConnections.authScheme,
        lastSyncedAt: thehiveConnections.lastSyncedAt,
        updatedAt: thehiveConnections.updatedAt,
        createdAt: thehiveConnections.createdAt,
      })
      .from(thehiveConnections)
      .where(eq(thehiveConnections.projectId, ctx.project.id))
      .orderBy(desc(thehiveConnections.updatedAt), desc(thehiveConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "TheHive tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  return json({ data: rows });
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const name = String(body?.name ?? "").trim();
  const enabled = body?.enabled == null ? true : Boolean(body.enabled);
  const baseUrlRaw = String(body?.baseUrl ?? "").trim();
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const apiKey = String(body?.apiKey ?? "").trim();

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!baseUrl) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });
  if (!apiKey) return json({ error: "apiKey is required" }, { status: 400 });
  if (apiKey.length < 12) return json({ error: "apiKey looks too short" }, { status: 400 });

  let apiKeyEnc: string;
  try {
    apiKeyEnc = await encryptSecret(apiKey);
  } catch (err) {
    const msg = String((err as any)?.message ?? err ?? "");
    if (/TI_SECRETS_KEY is not set/i.test(msg)) return json({ error: msg }, { status: 500 });
    return json({ error: "Failed to encrypt API key" }, { status: 500 });
  }

  try {
    const [row] = await db
      .insert(thehiveConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        enabled,
        baseUrl,
        authScheme: "bearer",
        apiKeyEnc,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: thehiveConnections.id,
        name: thehiveConnections.name,
        enabled: thehiveConnections.enabled,
        baseUrl: thehiveConnections.baseUrl,
        authScheme: thehiveConnections.authScheme,
        lastSyncedAt: thehiveConnections.lastSyncedAt,
        updatedAt: thehiveConnections.updatedAt,
        createdAt: thehiveConnections.createdAt,
      });

    return json({ ok: true, connection: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "TheHive tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create connection" }, { status: 400 });
  }
}
