export const runtime = "edge";
export const dynamic = "force-dynamic";

import { agentRuns, getDb, sourceReliabilitySnapshots, sources } from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { CsvExportButton } from "../../../../components/ui/CsvExportButton";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { InfoTip } from "../../../../components/ui/InfoTip";
import { buildHref, clamp, parsePositiveInt } from "../../../../lib/search-params";
import { toIsoStringSafe } from "../../../../lib/dates";
import { SourceEnabledToggle } from "./ui/SourceEnabledToggle";

type SortKey = "name" | "type" | "enabled" | "reliability" | "lastFetchedAt" | "createdAt";

type SearchParams = {
  q?: string;
  type?: string;
  enabled?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: string;
  limit?: string;
};

type Row = {
  id: string;
  name: string;
  type: string;
  url: string;
  enabled: boolean;
  reliability: number;
  reliabilitySnapshot: {
    computedAt: string | null;
    windowDays: number;
    totalClaims: number;
    confirmedClaims: number;
    confirmationRate: number;
    avgDelayHours: number | null;
    timelinessScore: number;
    maturedClaims: number;
    falsePositiveRate: number;
  } | null;
  lastFetchedAt: string | null;
  createdAt: string | null;
};

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortDirForNext(currentSort: string, currentDir: string, nextSort: string) {
  if (currentSort !== nextSort) return "asc";
  return currentDir === "asc" ? "desc" : "asc";
}

export default async function SourcesTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ? sp.q.trim() : "";
  const type = sp.type?.trim() ? sp.type.trim() : "";
  const enabled = sp.enabled?.trim() ? sp.enabled.trim() : "";

  const page = parsePositiveInt(sp.page, 1);
  const limit = clamp(parsePositiveInt(sp.limit, 25), 10, 100);
  const offset = (page - 1) * limit;

  const sort: SortKey = sp.sort ?? "name";
  const dir = sp.dir === "desc" ? "desc" : "asc";

  const db = getDb();

  const conditions = [];
  if (q) conditions.push(sql`${sources.name} ilike ${`%${q}%`} or ${sources.url} ilike ${`%${q}%`}`);
  if (type) conditions.push(eq(sources.type, type as never));
  if (enabled === "true") conditions.push(eq(sources.enabled, true));
  if (enabled === "false") conditions.push(eq(sources.enabled, false));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol =
    sort === "type"
      ? sources.type
      : sort === "enabled"
        ? sources.enabled
        : sort === "reliability"
          ? sources.reliability
          : sort === "lastFetchedAt"
            ? sources.lastFetchedAt
            : sort === "createdAt"
              ? sources.createdAt
              : sources.name;

  const orderPrimary = dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(sources)
    .where(whereExpr);

  const rowsRaw = await db
    .select({
      id: sources.id,
      name: sources.name,
      type: sources.type,
      url: sources.url,
      enabled: sources.enabled,
      reliability: sources.reliability,
      lastFetchedAt: sources.lastFetchedAt,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .where(whereExpr)
    .orderBy(orderPrimary, asc(sources.name))
    .limit(limit)
    .offset(offset);

  const ids = rowsRaw.map((r) => r.id);
  const snapshotBySourceId = new Map<
    string,
    {
      computedAt: string | null;
      windowDays: number;
      totalClaims: number;
      confirmedClaims: number;
      confirmationRate: number;
      avgDelayHours: number | null;
      timelinessScore: number;
      maturedClaims: number;
      falsePositiveRate: number;
    }
  >();

  if (ids.length > 0) {
    try {
      const snaps = await db
        .select({
          sourceId: sourceReliabilitySnapshots.sourceId,
          computedAt: sourceReliabilitySnapshots.computedAt,
          windowDays: sourceReliabilitySnapshots.windowDays,
          totalClaims: sourceReliabilitySnapshots.totalClaims,
          confirmedClaims: sourceReliabilitySnapshots.confirmedClaims,
          confirmationRate: sourceReliabilitySnapshots.confirmationRate,
          avgDelayHours: sourceReliabilitySnapshots.avgDelayHours,
          timelinessScore: sourceReliabilitySnapshots.timelinessScore,
          maturedClaims: sourceReliabilitySnapshots.maturedClaims,
          falsePositiveRate: sourceReliabilitySnapshots.falsePositiveRate,
        })
        .from(sourceReliabilitySnapshots)
        .where(and(eq(sourceReliabilitySnapshots.windowDays, 90), inArray(sourceReliabilitySnapshots.sourceId, ids)))
        .orderBy(desc(sourceReliabilitySnapshots.computedAt))
        .limit(ids.length * 5);

      for (const s of snaps) {
        if (snapshotBySourceId.has(s.sourceId)) continue;
        snapshotBySourceId.set(s.sourceId, {
          computedAt: toIsoStringSafe(s.computedAt),
          windowDays: Number(s.windowDays ?? 90),
          totalClaims: Number(s.totalClaims ?? 0),
          confirmedClaims: Number(s.confirmedClaims ?? 0),
          confirmationRate: Number(s.confirmationRate ?? 0),
          avgDelayHours: s.avgDelayHours == null ? null : Number(s.avgDelayHours),
          timelinessScore: Number(s.timelinessScore ?? 0),
          maturedClaims: Number(s.maturedClaims ?? 0),
          falsePositiveRate: Number(s.falsePositiveRate ?? 0),
        });
      }
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code !== "42P01") throw err;
    }
  }

  const rows: Row[] = rowsRaw.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    url: r.url,
    enabled: !!r.enabled,
    reliability: Number(r.reliability ?? 0),
    reliabilitySnapshot: snapshotBySourceId.get(r.id) ?? null,
    lastFetchedAt: toIsoStringSafe(r.lastFetchedAt),
    createdAt: toIsoStringSafe(r.createdAt),
  }));

  let vulnLastRun: { status: string; finishedAt: string | null } | null = null;
  try {
    const [run] = await db
      .select({ status: agentRuns.status, finishedAt: agentRuns.finishedAt })
      .from(agentRuns)
      .where(eq(agentRuns.agentKey, "vuln"))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);

    if (run) vulnLastRun = { status: String(run.status), finishedAt: toIsoStringSafe(run.finishedAt) };
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01") throw err;
  }

  const current: Record<string, string | undefined> = {
    q: q || undefined,
    type: type || undefined,
    enabled: enabled || undefined,
    sort,
    dir,
    page: String(page),
    limit: String(limit),
  };

  const prevHref =
    page > 1 ? buildHref("/data/sources", current, { page: String(page - 1) }) : null;
  const nextHref =
    rows.length === limit
      ? buildHref("/data/sources", current, { page: String(page + 1) })
      : null;

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Sources</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          RSS + STIX feeds and their ingestion health.
        </p>
        <p className="text-xs text-zinc-500">
          Note: NVD CVEs + CISA KEV are ingested by the <span className="font-mono">vuln</span> system agent
          {vulnLastRun?.finishedAt ? (
            <>
              {" "}
              (last run:{" "}
              <span className="tabular-nums">
                {new Date(vulnLastRun.finishedAt).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              , {vulnLastRun.status})
            </>
          ) : (
            ""
          )}
          . Manage system agents on <a className="underline hover:no-underline" href="/agents">/agents</a>.
        </p>
      </header>

      <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" action="/data/sources" method="get">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Search</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="Name or URL…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Type</div>
          <select
            name="type"
            defaultValue={type}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            <option value="rss">rss</option>
            <option value="stix">stix</option>
          </select>
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Enabled</div>
          <select
            name="enabled"
            defaultValue={enabled}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            <option value="true">Enabled only</option>
            <option value="false">Disabled only</option>
          </select>
        </label>

        <div className="flex items-center gap-2">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="limit" value={String(limit)} />
          <button className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95">
            Apply
          </button>
          <a
            href="/data/sources"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm hover:bg-white dark:hover:bg-black/40"
          >
            Reset
          </a>
        </div>
      </form>

      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-3">
              <span>Rows</span>
              <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400 tabular-nums">
                {nf(Number(total ?? 0))} total • page {page}
              </span>
            </div>
          }
          description={`Sorted by ${sort} (${dir}).`}
          right={
            <div className="flex items-center gap-2">
              <a
                href="/data/sources/new"
                className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm font-medium hover:opacity-95"
              >
                Add source
              </a>
              <CsvExportButton
                filename="sources.csv"
                rows={rows}
                columns={[
                  { header: "id", key: "id" },
                  { header: "name", key: "name" },
                  { header: "type", key: "type" },
                  { header: "url", key: "url" },
                  { header: "enabled", key: "enabled" },
                  { header: "reliability", key: "reliability" },
                  { header: "last_fetched_at", key: "lastFetchedAt" },
                  { header: "created_at", key: "createdAt" },
                ]}
              />
              {prevHref ? (
                <a
                  href={prevHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40"
                >
                  Prev
                </a>
              ) : null}
              {nextHref ? (
                <a
                  href={nextHref}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40"
                >
                  Next
                </a>
              ) : null}
            </div>
          }
        />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  {[
                    { key: "enabled", label: "Enabled" },
                    { key: "name", label: "Name" },
                    { key: "type", label: "Type" },
                    {
                      key: "reliability",
                      label: (
                        <span className="inline-flex items-center gap-1">
                          Reliability
                          <InfoTip
                            title="Reliability (0–1)"
                            body="Automatically computed from the last 90 days of evidence: corroboration rate, speed vs earliest report, and a false-positive proxy (claims still unconfirmed after 14 days)."
                            className="ml-0.5"
                          />
                        </span>
                      ),
                    },
                    { key: "lastFetchedAt", label: "Last fetch" },
                    { key: "createdAt", label: "Created" },
                    { key: "url", label: "URL" },
                  ].map(({ key, label }) => {
                    const nextDir = sortDirForNext(sort, dir, key);
                    const href = buildHref("/data/sources", current, {
                      sort: key,
                      dir: nextDir,
                      page: "1",
                    });
                    const active = sort === key;
                    return (
                      <th key={key} className="py-2 text-left font-medium whitespace-nowrap pr-4">
                        <a
                          href={href}
                          className={`hover:underline ${active ? "text-zinc-900 dark:text-zinc-100" : ""}`}
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
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <div className="space-y-2">
                        <span
                          className={`inline-flex items-center gap-2 text-sm ${r.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-400"}`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${r.enabled ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"}`}
                            aria-hidden="true"
                          />
                          {String(r.enabled)}
                        </span>
                        <SourceEnabledToggle sourceId={r.id} enabled={r.enabled} />
                      </div>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{r.name}</td>
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.type.toUpperCase()}
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span>{Math.round(r.reliability * 100)}%</span>
                        {r.reliabilitySnapshot ? (
                          <InfoTip
                            title={`Score details (${r.reliabilitySnapshot.windowDays}d)`}
                            body={[
                              `Confirmed: ${Math.round(r.reliabilitySnapshot.confirmationRate * 100)}% (${nf(r.reliabilitySnapshot.confirmedClaims)}/${nf(r.reliabilitySnapshot.totalClaims)})`,
                              `Avg delay: ${
                                typeof r.reliabilitySnapshot.avgDelayHours === "number"
                                  ? `${r.reliabilitySnapshot.avgDelayHours.toFixed(1)}h`
                                  : "n/a"
                              }`,
                              `False-positive proxy: ${Math.round(r.reliabilitySnapshot.falsePositiveRate * 100)}% (matured: ${nf(r.reliabilitySnapshot.maturedClaims)})`,
                              r.reliabilitySnapshot.totalClaims < 25 ? "Low sample: score held constant (<25 claims)." : null,
                              r.reliabilitySnapshot.computedAt
                                ? `Computed: ${new Date(r.reliabilitySnapshot.computedAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "2-digit",
                                    year: "numeric",
                                  })}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                            className="ml-0.5"
                          />
                        ) : null}
                      </span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.lastFetchedAt
                        ? new Date(r.lastFetchedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="py-3 min-w-[520px]">
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline text-zinc-700 dark:text-zinc-300">
                        {r.url}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
