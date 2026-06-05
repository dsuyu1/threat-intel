export const runtime = "edge";

import { getDb, kgEntities, kgRelations } from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActorMarquee } from "../../components/ActorMarquee";
import { toIsoStringSafe } from "../../lib/dates";

type ActorRow = {
  actorId: string;
  name: string;
  originIso2: string | null;
  ttpCount: number;
  mitigationCount: number;
  cveCount: number;
  sectorCount: number;
  lastSeen: string | null;
};

async function getActors(q: string | null): Promise<ActorRow[]> {
  const db = getDb();
  const where = q
    ? and(eq(kgEntities.kind, "actor"), sql`${kgEntities.name} ilike ${`%${q}%`}`)
    : eq(kgEntities.kind, "actor");

  const baseRows = await db
    .select({
      actorId: kgEntities.entityId,
      name: kgEntities.name,
      lastSeen: sql<string | Date | null>`max(${kgRelations.lastSeen})`,
      ttpCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_uses_technique' then ${kgRelations.toId} end)`,
      sectorCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_targets_sector' then ${kgRelations.toId} end)`,
      cveCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_exploits_cve' then ${kgRelations.toId} end)`,
    })
    .from(kgEntities)
    .leftJoin(
      kgRelations,
      and(eq(kgRelations.fromKind, "actor"), eq(kgRelations.fromId, kgEntities.entityId))
    )
    .where(where)
    .groupBy(kgEntities.entityId, kgEntities.name)
    .orderBy(desc(sql`max(${kgRelations.lastSeen})`))
    .limit(250);

  const actorIds = baseRows.map((r) => r.actorId);
  if (actorIds.length === 0) return [];

  const originRows = await db
    .select({
      actorId: kgRelations.fromId,
      iso2: kgRelations.toId,
      support: kgRelations.support,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, "actor_origin_country"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "country"),
        inArray(kgRelations.fromId, actorIds)
      )
    )
    .orderBy(asc(kgRelations.fromId), desc(kgRelations.support), desc(kgRelations.lastSeen))
    .limit(2000);

  const originByActor = new Map<string, string>();
  for (const r of originRows) {
    if (originByActor.has(r.actorId)) continue;
    originByActor.set(r.actorId, r.iso2);
  }

  const a2t = alias(kgRelations, "a2t");
  const t2m = alias(kgRelations, "t2m");

  const mitigationRows = await db
    .select({
      actorId: a2t.fromId,
      mitigationCount: sql<number>`count(distinct ${t2m.toId})`,
    })
    .from(a2t)
    .innerJoin(
      t2m,
      and(
        eq(t2m.type, "technique_mitigated_by"),
        eq(t2m.fromKind, "technique"),
        eq(t2m.toKind, "mitigation"),
        eq(t2m.fromId, a2t.toId)
      )
    )
    .where(
      and(
        eq(a2t.type, "actor_uses_technique"),
        eq(a2t.fromKind, "actor"),
        eq(a2t.toKind, "technique"),
        inArray(a2t.fromId, actorIds)
      )
    )
    .groupBy(a2t.fromId)
    .limit(2000);

  const mitigationByActor = new Map<string, number>();
  for (const r of mitigationRows) {
    mitigationByActor.set(r.actorId, Number(r.mitigationCount ?? 0));
  }

  return baseRows.map((r) => ({
    actorId: r.actorId,
    name: r.name,
    originIso2: originByActor.get(r.actorId) ?? null,
    ttpCount: Number(r.ttpCount ?? 0),
    sectorCount: Number(r.sectorCount ?? 0),
    cveCount: Number(r.cveCount ?? 0),
    mitigationCount: mitigationByActor.get(r.actorId) ?? 0,
    lastSeen: toIsoStringSafe(r.lastSeen),
  }));
}

export default async function ActorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ? q.trim() : null;
  const rows = await getActors(query);

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Threat actors
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-500">
          Browse actor profiles. Search pauses motion and filters the stream.
        </p>
      </header>

      <form className="flex items-center gap-2" action="/actors" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search actors…"
          className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
        <button className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white hover:bg-zinc-800 transition-colors">
          Search
        </button>
      </form>

      <ActorMarquee rows={rows} paused={Boolean(query)} />

      {Boolean(query) && (
        <div className="text-xs text-zinc-500">
          Showing {rows.length} result{rows.length === 1 ? "" : "s"} for{" "}
          <span className="text-zinc-700 dark:text-zinc-300">{query}</span>.
        </div>
      )}
    </div>
  );
}
