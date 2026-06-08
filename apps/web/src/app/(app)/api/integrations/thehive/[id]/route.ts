export const runtime = "edge";

import { and, eq } from "drizzle-orm";
import { getDb, thehiveConnections } from "@ti/db";
import { encryptSecret } from "../../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../../lib/tenancy";

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

  if (body?.apiKey != null) {
    const apiKey = String(body.apiKey).trim();
    if (!apiKey) return json({ error: "apiKey cannot be empty" }, { status: 400 });
    if (apiKey.length < 12) return json({ error: "apiKey looks too short" }, { status: 400 });
    try {
      patch.apiKeyEnc = await encryptSecret(apiKey);
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/TI_SECRETS_KEY is not set/i.test(msg)) return json({ error: msg }, { status: 500 });
      return json({ error: "Failed to encrypt API key" }, { status: 500 });
    }
  }

  if (patch.name === "") return json({ error: "name is required" }, { status: 400 });

  let row:
    | {
        id: string;
        name: string;
        enabled: boolean;
        baseUrl: string;
        authScheme: string;
        lastSyncedAt: Date | null;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(thehiveConnections)
      .set(patch)
      .where(
        and(
          eq(thehiveConnections.id, id),
          eq(thehiveConnections.projectId, viewer.project.id),
          eq(thehiveConnections.userId, viewer.user.id)
        )
      )
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
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "TheHive tables are missing. Run pnpm db:migrate." }, { status: 503 });
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
      .delete(thehiveConnections)
      .where(
        and(
          eq(thehiveConnections.id, id),
          eq(thehiveConnections.projectId, viewer.project.id),
          eq(thehiveConnections.userId, viewer.user.id)
        )
      )
      .returning({ id: thehiveConnections.id });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "TheHive tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}
