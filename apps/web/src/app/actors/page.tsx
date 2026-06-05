export const runtime = "edge";
export const dynamic = "force-dynamic";

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

type SortKey =
  | "origin"
  | "ttps"
  | "mitigations"
  | "cves"
  | "sectors"
  | "recent"
  | "name";

type SortDir = "asc" | "desc";

type SearchParams = {
  q?: string;
  origin?: string;
  sort?: SortKey;
  dir?: SortDir;
  minTtps?: string;
  minMitigations?: string;
  minCves?: string;
  minSectors?: string;
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

function parseMin(value: string | undefined) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored <= 0) return null;
  return floored;
}

function getCountryName(iso2: string) {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

export default async function ActorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ? sp.q.trim() : null;

  const originFilter = sp.origin?.trim() ? sp.origin.trim().toUpperCase() : null;
  const minTtps = parseMin(sp.minTtps);
  const minMitigations = parseMin(sp.minMitigations);
  const minCves = parseMin(sp.minCves);
  const minSectors = parseMin(sp.minSectors);

  const sort: SortKey = sp.sort ?? "recent";
  const dir: SortDir = sp.dir === "asc" ? "asc" : "desc";

  const allRows = await getActors(query);

  const availableOrigins = Array.from(
    new Set(allRows.map((r) => r.originIso2).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  const filtered = allRows
    .filter((r) => {
      if (!originFilter || originFilter === "ANY") return true;
      return (r.originIso2 ?? "").toUpperCase() === originFilter;
    })
    .filter((r) => (minTtps ? r.ttpCount >= minTtps : true))
    .filter((r) => (minMitigations ? r.mitigationCount >= minMitigations : true))
    .filter((r) => (minCves ? r.cveCount >= minCves : true))
    .filter((r) => (minSectors ? r.sectorCount >= minSectors : true));

  filtered.sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    switch (sort) {
      case "origin":
        return mul * (a.originIso2 ?? "").localeCompare(b.originIso2 ?? "");
      case "ttps":
        return mul * (a.ttpCount - b.ttpCount);
      case "mitigations":
        return mul * (a.mitigationCount - b.mitigationCount);
      case "cves":
        return mul * (a.cveCount - b.cveCount);
      case "sectors":
        return mul * (a.sectorCount - b.sectorCount);
      case "name":
        return mul * a.name.localeCompare(b.name);
      case "recent":
      default: {
        const at = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const bt = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return mul * (at - bt);
      }
    }
  });

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Threat actors
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-500">
          Filter and sort by origin, TTPs, mitigations, CVEs, and sectors.
        </p>
      </header>

      <form className="space-y-3" action="/actors" method="get">
        <div className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search actors…"
            className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
          <button className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white hover:bg-zinc-800 transition-colors">
            Apply
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Origin</div>
            <select
              name="origin"
              defaultValue={originFilter ?? "ANY"}
              className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            >
              <option value="ANY">Any</option>
              {availableOrigins.map((iso2) => (
                <option key={iso2} value={iso2}>
                  {getCountryName(iso2)} ({iso2})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Min TTPs</div>
            <input
              name="minTtps"
              inputMode="numeric"
              defaultValue={sp.minTtps ?? ""}
              className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="0"
            />
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Min mitigations</div>
            <input
              name="minMitigations"
              inputMode="numeric"
              defaultValue={sp.minMitigations ?? ""}
              className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="0"
            />
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Min CVEs</div>
            <input
              name="minCves"
              inputMode="numeric"
              defaultValue={sp.minCves ?? ""}
              className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="0"
            />
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Min sectors</div>
            <input
              name="minSectors"
              inputMode="numeric"
              defaultValue={sp.minSectors ?? ""}
              className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="0"
            />
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-500">Sort</div>
            <div className="flex gap-2">
              <select
                name="sort"
                defaultValue={sort}
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              >
                <option value="recent">Recent activity</option>
                <option value="origin">Origin</option>
                <option value="ttps">TTPs</option>
                <option value="mitigations">Mitigations</option>
                <option value="cves">CVEs</option>
                <option value="sectors">Sectors</option>
                <option value="name">Name</option>
              </select>
              <select
                name="dir"
                defaultValue={dir}
                className="w-[92px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </label>
        </div>

        <div className="text-xs text-zinc-500">
          Showing <span className="tabular-nums">{filtered.length}</span> of{" "}
          <span className="tabular-nums">{allRows.length}</span> actors.
        </div>
      </form>

      <ActorMarquee rows={filtered} />
    </div>
  );
}
