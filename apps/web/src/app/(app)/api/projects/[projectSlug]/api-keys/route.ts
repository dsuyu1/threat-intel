export const runtime = "edge";
export const dynamic = "force-dynamic";

import { apiKeys, getDb } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { generateApiKeySecret, normalizeScopes } from "../../../../../../lib/api-keys";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function parseId(req: Request) {
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await ctx.params;
  const viewer = await getViewerContext({ projectSlug });
  const db = getDb();

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, viewer.project.id))
    .orderBy(desc(apiKeys.createdAt))
    .limit(200);

  return json({ ok: true, apiKeys: rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await ctx.params;
  const viewer = await getViewerContext({ projectSlug });
  const db = getDb();

  const body = (await req.json().catch(() => null)) as any;
  const name = String(body?.name ?? "").trim() || "API key";
  const rateLimitPerMinRaw = Number(body?.rateLimitPerMin ?? 60);
  const rateLimitPerMin = Math.max(1, Math.min(600, Math.floor(rateLimitPerMinRaw)));

  const scopes = normalizeScopes(body?.scopes);
  if (!scopes.length) {
    return json({ error: "At least one scope is required" }, { status: 400 });
  }

  const { secret, keyHash, keyPrefix } = await generateApiKeySecret();

  const [created] = await db
    .insert(apiKeys)
    .values({
      projectId: viewer.project.id,
      userId: viewer.user.id,
      name,
      keyPrefix,
      keyHash,
      scopes: JSON.stringify(scopes),
      rateLimitPerMin,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      createdAt: apiKeys.createdAt,
    });

  if (!created) return json({ error: "Failed to create API key" }, { status: 500 });
  return json({ ok: true, apiKey: created, secret });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await ctx.params;
  const viewer = await getViewerContext({ projectSlug });
  const db = getDb();

  const id = parseId(req);
  if (!id) return json({ error: "id is required" }, { status: 400 });

  const now = new Date();
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.projectId, viewer.project.id)))
    .returning({ id: apiKeys.id });

  if (!row) return json({ error: "API key not found" }, { status: 404 });
  return json({ ok: true });
}

