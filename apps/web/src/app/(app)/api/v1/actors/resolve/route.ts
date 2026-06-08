export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgAliases, kgEntities } from "@ti/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../../lib/api-auth";

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

function looksLikeActorId(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return /^G\d{4,}$/i.test(s) || /^U-[0-9a-f-]{8,}$/i.test(s);
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "actors:read" });
  if (!auth.ok) return auth.res;

  const u = new URL(req.url);
  const q = String(u.searchParams.get("q") ?? "").trim();
  if (!q) return json({ error: "Missing q" }, { status: 400 });
  if (q.length > 200) return json({ error: "q is too long" }, { status: 400 });

  const db = getDb();

  if (looksLikeActorId(q)) {
    const actorId = q.toUpperCase();
    const [row] = await db
      .select({ entityId: kgEntities.entityId })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, actorId)))
      .limit(1);

    if (row?.entityId) {
      return json({ ok: true, actorId: row.entityId, matchedOn: "id" as const });
    }
  }

  const aliasNorm = normalizeAlias(q);
  if (aliasNorm) {
    const [row] = await db
      .select({ entityId: kgAliases.entityId })
      .from(kgAliases)
      .where(and(eq(kgAliases.kind, "actor"), eq(kgAliases.aliasNorm, aliasNorm)))
      .limit(1);

    if (row?.entityId) {
      return json({ ok: true, actorId: row.entityId, matchedOn: "alias" as const });
    }
  }

  const candidates = await db
    .select({
      actorId: kgEntities.entityId,
      name: kgEntities.name,
      description: kgEntities.description,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "actor"), sql`${kgEntities.name} ilike ${`%${q}%`}`))
    .orderBy(asc(kgEntities.name))
    .limit(5);

  if (candidates.length === 1) {
    return json({
      ok: true,
      actorId: candidates[0]!.actorId,
      matchedOn: "name" as const,
      candidates: candidates.map((c) => ({ actorId: c.actorId, name: c.name, description: c.description ?? null })),
    });
  }

  return json({
    ok: true,
    actorId: null,
    matchedOn: null,
    candidates: candidates.map((c) => ({ actorId: c.actorId, name: c.name, description: c.description ?? null })),
  });
}

