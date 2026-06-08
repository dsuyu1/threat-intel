export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgEntities, kgRelations } from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActorMarquee } from "../../../components/ActorMarquee";
import { ActorRelationshipGraph } from "../../../components/ActorRelationshipGraph";
import { ActorIcon } from "../../../components/ui/ActorIcon";
import { toIsoStringSafe } from "../../../lib/dates";
import { buildHref, clamp, parsePositiveInt } from "../../../lib/search-params";

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
  view?: "cards" | "table" | "graph";
  focus?: string;
  depth?: string;
  similarity?: string;
  derived?: string;
  page?: string;
  limit?: string;
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
      ttpCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_uses_technique' and ${kgRelations.toKind} = 'technique' then ${kgRelations.toId} end)`,
      sectorCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_targets_sector' and ${kgRelations.toKind} = 'sector' then ${kgRelations.toId} end)`,
      cveCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_exploits_cve' and ${kgRelations.toKind} = 'cve' then ${kgRelations.toId} end)`,
    })
    .from(kgEntities)
    .leftJoin(
      kgRelations,
      and(
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.fromId, kgEntities.entityId)
      )
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
    .orderBy(
      asc(kgRelations.fromId),
      desc(kgRelations.support),
      desc(kgRelations.lastSeen)
    )
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

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getCountryName(iso2: string) {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

function actorAnchorId(actorId: string) {
  return `actor-${actorId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function sortLabel(key: SortKey) {
  if (key === "recent") return "Recent activity";
  if (key === "origin") return "Origin";
  if (key === "ttps") return "TTPs";
  if (key === "mitigations") return "Mitigations";
  if (key === "cves") return "CVEs";
  if (key === "sectors") return "Sectors";
  if (key === "name") return "Name";
  return key;
}

export default async function ActorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ? sp.q.trim() : null;

  const originRaw = sp.origin?.trim() ? sp.origin.trim().toUpperCase() : null;
  const originFilter = originRaw && originRaw !== "ANY" ? originRaw : null;

  const minTtps = parseMin(sp.minTtps);
  const minMitigations = parseMin(sp.minMitigations);
  const minCves = parseMin(sp.minCves);
  const minSectors = parseMin(sp.minSectors);

  const sort: SortKey = sp.sort ?? "recent";
  const dir: SortDir = sp.dir === "asc" ? "asc" : "desc";
  const view = sp.view === "table" ? "table" : sp.view === "cards" ? "cards" : "graph";

  const graphFocus = sp.focus?.trim() ? sp.focus.trim() : null;
  const graphDepth = clamp(parsePositiveInt(sp.depth, 2), 1, 4);
  const graphSimilarity =
    sp.similarity === "0" || sp.similarity === "false" ? false : true;
  const graphDerived = sp.derived === "1" || sp.derived === "true";

  const limit = clamp(parsePositiveInt(sp.limit, 50), 25, 50);
  const pageRequested = parsePositiveInt(sp.page, 1);

  const allRows = await getActors(query);

  const thresholded = allRows
    .filter((r) => (minTtps ? r.ttpCount >= minTtps : true))
    .filter((r) =>
      minMitigations ? r.mitigationCount >= minMitigations : true
    )
    .filter((r) => (minCves ? r.cveCount >= minCves : true))
    .filter((r) => (minSectors ? r.sectorCount >= minSectors : true));

  const originCounts = new Map<string, number>();
  for (const r of thresholded) {
    const iso2 = r.originIso2;
    if (!iso2) continue;
    originCounts.set(iso2, (originCounts.get(iso2) ?? 0) + 1);
  }

  const availableOrigins = Array.from(originCounts.keys())
    .concat(originFilter ? [originFilter] : [])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b));

  const filtered = thresholded.filter((r) => {
    if (!originFilter) return true;
    return (r.originIso2 ?? "").toUpperCase() === originFilter;
  });

  const sorted = filtered.slice();
  sorted.sort((a, b) => {
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

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, Math.min(totalPages, pageRequested));
  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageRows = sorted.slice(start, end);

  const current: Record<string, string | undefined> = {
    q: query ?? undefined,
    origin: originFilter ?? undefined,
    minTtps: minTtps ? String(minTtps) : undefined,
    minMitigations: minMitigations ? String(minMitigations) : undefined,
    minCves: minCves ? String(minCves) : undefined,
    minSectors: minSectors ? String(minSectors) : undefined,
    sort: sort !== "recent" ? sort : undefined,
    dir: dir !== "desc" ? dir : undefined,
    view: view !== "graph" ? view : undefined,
    focus: graphFocus ?? undefined,
    depth: graphDepth !== 2 ? String(graphDepth) : undefined,
    similarity: graphSimilarity ? undefined : "0",
    derived: graphDerived ? "1" : undefined,
    limit: limit !== 50 ? String(limit) : undefined,
    page: page > 1 ? String(page) : undefined,
  };

  const chips: Array<{ label: string; href: string }> = [];
  const resetPage = { page: undefined };

  if (query) {
    chips.push({
      label: `Search: ${query}`,
      href: buildHref("/actors", current, { q: undefined, ...resetPage }),
    });
  }

  if (originFilter) {
    const name = getCountryName(originFilter);
    chips.push({
      label: `Origin: ${name} (${originFilter})`,
      href: buildHref("/actors", current, { origin: undefined, ...resetPage }),
    });
  }

  if (minTtps) {
    chips.push({
      label: `Min TTPs: ${nf(minTtps)}`,
      href: buildHref("/actors", current, { minTtps: undefined, ...resetPage }),
    });
  }

  if (minMitigations) {
    chips.push({
      label: `Min mitigations: ${nf(minMitigations)}`,
      href: buildHref("/actors", current, {
        minMitigations: undefined,
        ...resetPage,
      }),
    });
  }

  if (minCves) {
    chips.push({
      label: `Min CVEs: ${nf(minCves)}`,
      href: buildHref("/actors", current, { minCves: undefined, ...resetPage }),
    });
  }

  if (minSectors) {
    chips.push({
      label: `Min sectors: ${nf(minSectors)}`,
      href: buildHref("/actors", current, {
        minSectors: undefined,
        ...resetPage,
      }),
    });
  }

  if (sort !== "recent" || dir !== "desc") {
    chips.push({
      label: `Sort: ${sortLabel(sort)} (${dir})`,
      href: buildHref("/actors", current, {
        sort: undefined,
        dir: undefined,
        ...resetPage,
      }),
    });
  }

  const clearAllHref = buildHref("/actors", current, {
    q: undefined,
    origin: undefined,
    minTtps: undefined,
    minMitigations: undefined,
    minCves: undefined,
    minSectors: undefined,
    sort: undefined,
    dir: undefined,
    page: undefined,
  });

  const prevHref =
    page > 1
      ? buildHref("/actors", current, {
          page: page - 1 > 1 ? String(page - 1) : undefined,
        })
      : null;
  const nextHref =
    page < totalPages
      ? buildHref("/actors", current, {
          page: String(page + 1),
        })
      : null;

  const cardsHref = buildHref("/actors", current, { view: "cards", page: undefined });
  const tableHref = buildHref("/actors", current, { view: "table" });
  const graphHref = buildHref("/actors", current, { view: undefined, page: undefined });

  const actorOptions = sorted.map((r) => ({ actorId: r.actorId, name: r.name }));
  const graphInitialActorId =
    graphFocus && actorOptions.some((o) => o.actorId === graphFocus)
      ? graphFocus
      : actorOptions[0]?.actorId ?? null;

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const nameSorted = sorted.slice().sort((a, b) => a.name.localeCompare(b.name));
  const jumpByLetter = new Map<string, { actorId: string; page: number }>();
  for (let i = 0; i < nameSorted.length; i++) {
    const first = (nameSorted[i]?.name?.trim()?.[0] ?? "").toUpperCase();
    if (!/^[A-Z]$/.test(first)) continue;
    if (jumpByLetter.has(first)) continue;
    jumpByLetter.set(first, {
      actorId: nameSorted[i]!.actorId,
      page: Math.floor(i / limit) + 1,
    });
  }

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Threat actor library
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-500">
          Filter and sort by origin, TTPs, mitigations, CVEs, and sectors.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(360px,440px)_1fr] gap-8 items-start">
        <aside className="lg:sticky lg:top-6">
          <form
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 backdrop-blur p-4 space-y-3"
            action="/actors"
            method="get"
          >
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="page" value="1" />

            <div className="flex items-center gap-2">
              <input
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Search actors..."
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
              <button className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white hover:bg-zinc-800 transition-colors">
                Apply
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <div className="text-[11px] text-zinc-500">Origin</div>
                <select
                  name="origin"
                  defaultValue={originFilter ?? "ANY"}
                  className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                >
                  <option value="ANY">Any · {nf(thresholded.length)}</option>
                  {availableOrigins.map((iso2) => (
                    <option key={iso2} value={iso2}>
                      {getCountryName(iso2)} ({iso2}) ·{" "}
                      {nf(originCounts.get(iso2) ?? 0)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-[11px] text-zinc-500">Per page</div>
                <select
                  name="limit"
                  defaultValue={String(limit)}
                  className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
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

              <label className="space-y-1 col-span-2">
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
              Showing <span className="tabular-nums">{nf(total)}</span> of{" "}
              <span className="tabular-nums">{nf(allRows.length)}</span> actors.
            </div>
          </form>
        </aside>

        <section className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {total ? (
                <>
                  Showing <span className="tabular-nums">{nf(start + 1)}</span>-
                  <span className="tabular-nums">{nf(end)}</span> of{" "}
                  <span className="tabular-nums">{nf(total)}</span>
                </>
              ) : (
                "No matches"
              )}
            </div>
            <div className="flex items-center gap-2">
              <a
                href={cardsHref}
                className={`rounded-md border px-2 py-1 text-xs ${
                  view === "cards"
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                }`}
              >
                Cards
              </a>
              <a
                href={tableHref}
                className={`rounded-md border px-2 py-1 text-xs ${
                  view === "table"
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                }`}
              >
                Table
              </a>
              <a
                href={graphHref}
                className={`rounded-md border px-2 py-1 text-xs ${
                  view === "graph"
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                }`}
              >
                Graph
              </a>
            </div>
          </div>

          {chips.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                  aria-label={`Remove filter: ${c.label}`}
                >
                  <span className="truncate max-w-[380px]">{c.label}</span>
                  <span className="text-zinc-500">x</span>
                </a>
              ))}
              <a
                href={clearAllHref}
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
              >
                Clear all
              </a>
            </div>
          ) : null}

          {total && view !== "graph" ? (
            <div className="flex flex-wrap gap-1 text-xs">
              {letters.map((letter) => {
                const target = jumpByLetter.get(letter);
                if (!target) {
                  return (
                    <span
                      key={letter}
                      className="inline-flex w-6 justify-center rounded-md border border-transparent text-zinc-400 dark:text-zinc-600 select-none"
                    >
                      {letter}
                    </span>
                  );
                }
                const href =
                  buildHref("/actors", current, {
                    sort: "name",
                    dir: "asc",
                    page: target.page > 1 ? String(target.page) : undefined,
                  }) + `#${actorAnchorId(target.actorId)}`;
                return (
                  <a
                    key={letter}
                    href={href}
                    className="inline-flex w-6 justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                    title={`Jump to ${letter}`}
                  >
                    {letter}
                  </a>
                );
              })}
            </div>
          ) : null}

          {totalPages > 1 && view !== "graph" ? (
            <div className="flex items-center gap-2 text-sm">
              {prevHref ? (
                <a
                  href={prevHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 hover:bg-white dark:hover:bg-black/40"
                >
                  Prev
                </a>
              ) : (
                <span className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 px-3 py-1.5 text-zinc-400 dark:text-zinc-600">
                  Prev
                </span>
              )}

              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                Page <span className="tabular-nums">{page}</span> /{" "}
                <span className="tabular-nums">{totalPages}</span>
              </span>

              {nextHref ? (
                <a
                  href={nextHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 hover:bg-white dark:hover:bg-black/40"
                >
                  Next
                </a>
              ) : (
                <span className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 px-3 py-1.5 text-zinc-400 dark:text-zinc-600">
                  Next
                </span>
              )}
            </div>
          ) : null}

          {view === "graph" ? (
            <ActorRelationshipGraph
              actorOptions={actorOptions}
              initialActorId={graphInitialActorId}
              initialDepth={graphDepth}
              initialIncludeSimilarity={graphSimilarity}
              initialIncludeDerived={graphDerived}
            />
          ) : view === "table" ? (
            <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                  <tr>
                    {[
                      ["name", "Name"],
                      ["origin", "Origin"],
                      ["ttps", "TTPs"],
                      ["mitigations", "Mitigations"],
                      ["cves", "CVEs"],
                      ["sectors", "Sectors"],
                      ["recent", "Recent"],
                    ].map(([key, label]) => {
                      const col = key as SortKey;
                      const defaultDir =
                        col === "name" || col === "origin" ? "asc" : "desc";
                      const nextDir =
                        sort !== col ? defaultDir : dir === "asc" ? "desc" : "asc";

                      const href = buildHref("/actors", current, {
                        sort: col === "recent" ? undefined : col,
                        dir: nextDir === "desc" ? undefined : nextDir,
                        page: undefined,
                      });
                      const active = sort === col;
                      return (
                        <th
                          key={key}
                          className="py-2 px-4 text-left font-medium whitespace-nowrap"
                        >
                          <a
                            href={href}
                            className={`hover:underline ${
                              active ? "text-zinc-900 dark:text-zinc-100" : ""
                            }`}
                          >
                            {label}
                            {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
                          </a>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                  {pageRows.map((r) => {
                    const originLabel = r.originIso2
                      ? getCountryName(r.originIso2)
                      : "Unknown";
                    const originValue = r.originIso2
                      ? `${originLabel} (${r.originIso2})`
                      : originLabel;
                    const anchorId = actorAnchorId(r.actorId);

                    return (
                      <tr
                        key={r.actorId}
                        id={anchorId}
                        className="hover:bg-white/60 dark:hover:bg-black/30"
                      >
                        <td className="py-3 px-4 min-w-[260px]">
                          <a
                            href={`/actors/${r.actorId}`}
                            className="flex items-center gap-3 min-w-0"
                          >
                            <ActorIcon
                              seed={r.actorId}
                              size={28}
                              title={r.name}
                              className="shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {r.name}
                              </div>
                              <div className="text-[11px] text-zinc-500 tabular-nums">
                                {r.actorId}
                              </div>
                            </div>
                          </a>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                          {originValue}
                        </td>
                        <td className="py-3 px-4 tabular-nums">{nf(r.ttpCount)}</td>
                        <td className="py-3 px-4 tabular-nums">
                          {nf(r.mitigationCount)}
                        </td>
                        <td className="py-3 px-4 tabular-nums">{nf(r.cveCount)}</td>
                        <td className="py-3 px-4 tabular-nums">
                          {nf(r.sectorCount)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                          {r.lastSeen
                            ? new Date(r.lastSeen).toLocaleDateString("en-US", {
                                month: "short",
                                day: "2-digit",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {!pageRows.length ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-10 px-4 text-sm text-zinc-600 dark:text-zinc-400"
                      >
                        No actors found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <ActorMarquee rows={pageRows} />
          )}

          {totalPages > 1 ? (
            <div className="flex items-center gap-2 text-sm">
              {prevHref ? (
                <a
                  href={prevHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 hover:bg-white dark:hover:bg-black/40"
                >
                  Prev
                </a>
              ) : (
                <span className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 px-3 py-1.5 text-zinc-400 dark:text-zinc-600">
                  Prev
                </span>
              )}

              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                Page <span className="tabular-nums">{page}</span> /{" "}
                <span className="tabular-nums">{totalPages}</span>
              </span>

              {nextHref ? (
                <a
                  href={nextHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 hover:bg-white dark:hover:bg-black/40"
                >
                  Next
                </a>
              ) : (
                <span className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 px-3 py-1.5 text-zinc-400 dark:text-zinc-600">
                  Next
                </span>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}