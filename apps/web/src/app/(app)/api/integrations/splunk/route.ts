export const runtime = "edge";

import { getDb, splunkConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../lib/tenancy";
import { decryptSecret, encryptSecret } from "../../../../../lib/secretbox";

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
    username: string;
    app: string;
    owner: string;
    updatedAt: Date;
    createdAt: Date;
  }> = [];

  try {
    rows = await db
      .select({
        id: splunkConnections.id,
        name: splunkConnections.name,
        enabled: splunkConnections.enabled,
        baseUrl: splunkConnections.baseUrl,
        username: splunkConnections.username,
        app: splunkConnections.app,
        owner: splunkConnections.owner,
        updatedAt: splunkConnections.updatedAt,
        createdAt: splunkConnections.createdAt,
      })
      .from(splunkConnections)
      .where(eq(splunkConnections.projectId, ctx.project.id))
      .orderBy(desc(splunkConnections.updatedAt), desc(splunkConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
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
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const app = String(body?.app ?? "search").trim() || "search";
  const owner = String(body?.owner ?? "nobody").trim() || "nobody";

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!baseUrl) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });
  if (!username) return json({ error: "username is required" }, { status: 400 });
  if (!password) return json({ error: "password is required" }, { status: 400 });

  let passwordEnc = "";
  try {
    passwordEnc = await encryptSecret(password);
    const roundtrip = await decryptSecret(passwordEnc);
    if (roundtrip !== password) throw new Error("Encryption roundtrip failed");
  } catch (err) {
    const msg = String((err as any)?.message ?? err ?? "");
    if (/TI_SECRETS_KEY is not set/i.test(msg)) {
      return json({ error: "TI_SECRETS_KEY is not set (required to store Splunk credentials safely)." }, { status: 500 });
    }
    return json({ error: "Failed to encrypt Splunk password" }, { status: 500 });
  }

  try {
    const [row] = await db
      .insert(splunkConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        enabled,
        baseUrl,
        username,
        password: passwordEnc,
        app,
        owner,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: splunkConnections.id,
        name: splunkConnections.name,
        enabled: splunkConnections.enabled,
        baseUrl: splunkConnections.baseUrl,
        username: splunkConnections.username,
        app: splunkConnections.app,
        owner: splunkConnections.owner,
        updatedAt: splunkConnections.updatedAt,
        createdAt: splunkConnections.createdAt,
      });
    return json({ ok: true, connection: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create connection" }, { status: 400 });
  }
}
