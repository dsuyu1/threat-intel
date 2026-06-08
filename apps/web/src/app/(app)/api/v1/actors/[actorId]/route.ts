export const runtime = "edge";
export const dynamic = "force-dynamic";

import { actorNeighbors, actorProfiles, getDb, kgEntities, kgRelations } from "@ti/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireApiKey } from "../../../../../../lib/api-auth";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function safeIso(d: Date | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ actorId: string }> }) {
  const auth = await requireApiKey(req, { scope: "actors:read" });
  if (!auth.ok) return auth.res;

  const { actorId: actorIdRaw } = await ctx.params;
  const actorId = String(actorIdRaw ?? "").trim();
  if (!actorId) return json({ error: "Missing actorId" }, { status: 400 });
  if (actorId.length > 64) return json({ error: "actorId is too long" }, { status: 400 });

  const db = getDb();

  const [core] = await db
    .select({
      kind: kgEntities.kind,
      actorId: kgEntities.entityId,
      name: kgEntities.name,
      aliases: kgEntities.aliases,
      description: kgEntities.description,
      attributes: kgEntities.attributes,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, actorId)))
    .limit(1);

  if (!core?.actorId) return json({ error: "Actor not found" }, { status: 404 });

  const [profile] = await db
    .select({ profileText: actorProfiles.profileText, updatedAt: actorProfiles.updatedAt })
    .from(actorProfiles)
    .where(eq(actorProfiles.actorId, actorId))
    .limit(1);

  const rel = alias(kgRelations, "rel");
  const ent = alias(kgEntities, "ent");

  async function getRelations(params: { type: string; toKind: string; limit: number }) {
    const rows = await db
      .select({
        id: rel.toId,
        name: ent.name,
        description: ent.description,
        attributes: ent.attributes,
        support: rel.support,
        confidence: rel.confidence,
        firstSeen: rel.firstSeen,
        lastSeen: rel.lastSeen,
      })
      .from(rel)
      .innerJoin(ent, and(eq(ent.kind, params.toKind), eq(ent.entityId, rel.toId)))
      .where(
        and(
          eq(rel.type, params.type),
          eq(rel.fromKind, "actor"),
          eq(rel.fromId, actorId),
          eq(rel.toKind, params.toKind)
        )
      )
      .orderBy(desc(rel.confidence), desc(rel.support), desc(rel.lastSeen), asc(ent.name))
      .limit(params.limit);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      attributes: (r.attributes ?? null) as any,
      support: Number(r.support ?? 0),
      confidence: Number(r.confidence ?? 0),
      firstSeen: safeIso(r.firstSeen as any),
      lastSeen: safeIso(r.lastSeen as any),
    }));
  }

  const [ttps, cves, sectors, neighborsRaw] = await Promise.all([
    getRelations({ type: "actor_uses_technique", toKind: "technique", limit: 200 }),
    getRelations({ type: "actor_exploits_cve", toKind: "cve", limit: 200 }),
    getRelations({ type: "actor_targets_sector", toKind: "sector", limit: 100 }),
    (async () => {
      const neighborEnt = alias(kgEntities, "neighbor_ent");
      const rows = await db
        .select({
          neighborActorId: actorNeighbors.neighborActorId,
          neighborName: neighborEnt.name,
          distance: actorNeighbors.distance,
          whyJson: actorNeighbors.whyJson,
          computedAt: actorNeighbors.computedAt,
        })
        .from(actorNeighbors)
        .innerJoin(
          neighborEnt,
          and(eq(neighborEnt.kind, "actor"), eq(neighborEnt.entityId, actorNeighbors.neighborActorId))
        )
        .where(eq(actorNeighbors.actorId, actorId))
        .orderBy(asc(actorNeighbors.distance), desc(actorNeighbors.computedAt), asc(actorNeighbors.neighborActorId))
        .limit(50);

      return rows.map((r) => ({
        actorId: r.neighborActorId,
        name: r.neighborName,
        distance: Number(r.distance ?? 0),
        why: (r.whyJson ?? null) as any,
        computedAt: safeIso(r.computedAt as any),
      }));
    })(),
  ]);

  return json({
    ok: true,
    actor: {
      id: core.actorId,
      name: core.name,
      aliases: Array.isArray(core.aliases) ? core.aliases : null,
      description: core.description ?? null,
      attributes: (core.attributes ?? null) as any,
      profileText: profile?.profileText ?? null,
      profileUpdatedAt: safeIso(profile?.updatedAt as any),
    },
    ttps,
    cves,
    sectors,
    neighbors: neighborsRaw,
  });
}
