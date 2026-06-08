export const runtime = "edge";

import { getDb, splunkConnections } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { decryptSecret, encryptSecret } from "../../../../../../lib/secretbox";

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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const patch: Record<string, any> = { updatedAt: new Date() };
  if (body?.name != null) patch.name = String(body.name).trim();
  if (body?.enabled != null) patch.enabled = Boolean(body.enabled);

  if (body?.baseUrl != null) {
    const href = normalizeBaseUrl(String(body.baseUrl).trim());
    if (!href) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });
    patch.baseUrl = href;
  }
  if (body?.username != null) patch.username = String(body.username).trim();
  if (body?.password != null) {
    const pw = String(body.password);
    if (!pw) return json({ error: "password cannot be empty" }, { status: 400 });

    try {
      const passwordEnc = await encryptSecret(pw);
      const roundtrip = await decryptSecret(passwordEnc);
      if (roundtrip !== pw) throw new Error("Encryption roundtrip failed");
      patch.password = passwordEnc;
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/TI_SECRETS_KEY is not set/i.test(msg)) {
        return json({ error: "TI_SECRETS_KEY is not set (required to store Splunk credentials safely)." }, { status: 500 });
      }
      return json({ error: "Failed to encrypt Splunk password" }, { status: 500 });
    }
  }
  if (body?.app != null) patch.app = String(body.app).trim() || "search";
  if (body?.owner != null) patch.owner = String(body.owner).trim() || "nobody";

  if (patch.name === "") return json({ error: "name is required" }, { status: 400 });
  if (patch.username === "") return json({ error: "username is required" }, { status: 400 });

  let row:
    | {
        id: string;
        name: string;
        enabled: boolean;
        baseUrl: string;
        username: string;
        app: string;
        owner: string;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(splunkConnections)
      .set(patch)
      .where(
        and(
          eq(splunkConnections.id, id),
          eq(splunkConnections.projectId, viewer.project.id),
          eq(splunkConnections.userId, viewer.user.id)
        )
      )
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
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, connection: row });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });

  let row: { id: string } | undefined;
  try {
    [row] = await db
      .delete(splunkConnections)
      .where(
        and(
          eq(splunkConnections.id, id),
          eq(splunkConnections.projectId, viewer.project.id),
          eq(splunkConnections.userId, viewer.user.id)
        )
      )
      .returning({ id: splunkConnections.id });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}
