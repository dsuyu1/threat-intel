export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, findings } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CsvExportButton } from "../../../../components/ui/CsvExportButton";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { buildHref, clamp, parsePositiveInt } from "../../../../lib/search-params";
import { toIsoStringSafe } from "../../../../lib/dates";

type SortKey =
  | "publishedAt"
  | "createdAt"
  | "cvssScore"
  | "severity"
  | "cveId"
  | "agent"
  | "pocCount"
  | "title";

type SearchParams = {
  q?: string;
  agent?: string;
  severity?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: string;
  limit?: string;
};

type FindingRow = {
  id: string;
  title: string;
  agent: string;
  severity: string;
  cveId: string | null;
  cvssScore: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  pocCount: number;
};

const AGENTS = ["vuln", "attack", "ttp", "exploit", "malware"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortDirForNext(currentSort: string, currentDir: string, nextSort: string) {
  if (currentSort !== nextSort) return "desc";
  return currentDir === "asc" ? "desc" : "asc";
}

function ExternalLinkIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      <path d="M14 3h7v7" />
      <path d="M10 14L21 3" />
      <path d="M21 14v7H3V3h7" />
    </svg>
  );
}

export default async function FindingsTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ? sp.q.trim() : "";
  const agent = sp.agent?.trim() ? sp.agent.trim() : "";
  const severity = sp.severity?.trim() ? sp.severity.trim() : "";

  const page = parsePositiveInt(sp.page, 1);
  const limit = clamp(parsePositiveInt(sp.limit, 25), 10, 100);
  const offset = (page - 1) * limit;

  const sort: SortKey = [
    "publishedAt",
    "createdAt",
    "cvssScore",
    "severity",
    "cveId",
    "agent",
    "pocCount",
    "title",
  ].includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : "publishedAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const db = getDb();

  const conditions = [];
  if (q) {
    conditions.push(
      sql`${findings.title} ilike ${`%${q}%`} or ${findings.summary} ilike ${`%${q}%`} or ${findings.cveId} ilike ${`%${q}%`} or ${findings.sourceUrl} ilike ${`%${q}%`} or ${findings.pocUrl} ilike ${`%${q}%`}`
    );
  }
  if (agent) conditions.push(eq(findings.agent, agent as never));
  if (severity === "critical") conditions.push(sql`${findings.cvssScore} >= ${9}`);
  else if (severity === "high")
    conditions.push(sql`${findings.cvssScore} >= ${7} and ${findings.cvssScore} < ${9}`);
  else if (severity === "medium")
    conditions.push(sql`${findings.cvssScore} >= ${4} and ${findings.cvssScore} < ${7}`);
  else if (severity === "low") conditions.push(sql`${findings.cvssScore} < ${4}`);
  else if (severity === "info") conditions.push(sql`${findings.cvssScore} is null`);
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const groupKey = sql<string>`case when ${findings.agent} = 'exploit' and ${findings.cveId} is not null then ${findings.cveId} else ${findings.id}::text end`;
  const publishedAtAgg = sql<Date | null>`max(${findings.publishedAt})`;
  const createdAtAgg = sql<Date | null>`max(${findings.createdAt})`;
  const cveIdAgg = sql<string | null>`max(${findings.cveId})`;
  const agentAgg = sql<string>`(max(${findings.agent}))::text`;
  const cvssScoreAgg = sql<number | null>`max(${findings.cvssScore})`;
  const cvssScoreTextAgg = sql<string | null>`(max(${findings.cvssScore}))::text`;
  const severityAgg = sql<string>`case
    when max(${findings.cvssScore}) >= 9 then 'critical'
    when max(${findings.cvssScore}) >= 7 then 'high'
    when max(${findings.cvssScore}) >= 4 then 'medium'
    when max(${findings.cvssScore}) is not null then 'low'
    else 'info'
  end`;
  const severityRankAgg = sql<number>`case
    when max(${findings.cvssScore}) >= 9 then 4
    when max(${findings.cvssScore}) >= 7 then 3
    when max(${findings.cvssScore}) >= 4 then 2
    when max(${findings.cvssScore}) is not null then 1
    else 0
  end`;
  const orderByAgg = sql`order by ${findings.publishedAt} desc nulls last, ${findings.createdAt} desc, ${findings.id} desc`;
  const idAgg = sql<string>`((array_agg(${findings.id} ${orderByAgg}))[1])::text`;
  const titleAgg = sql<string>`(array_agg(${findings.title} ${orderByAgg}))[1]`;
  const urlAgg = sql<string | null>`(array_agg(coalesce(${findings.pocUrl}, ${findings.sourceUrl}) ${orderByAgg}))[1]`;
  const pocCountAgg = sql<number>`(count(*) filter (where ${findings.pocUrl} is not null))::int`;

  const sortCol =
    sort === "createdAt"
      ? createdAtAgg
      : sort === "cvssScore"
        ? cvssScoreAgg
        : sort === "severity"
          ? severityRankAgg
          : sort === "cveId"
            ? cveIdAgg
            : sort === "agent"
              ? agentAgg
              : sort === "pocCount"
                ? pocCountAgg
                : sort === "title"
                  ? titleAgg
                  : publishedAtAgg;

  const orderPrimary = dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${groupKey})` })
    .from(findings)
    .where(whereExpr);

  const rowsRaw = await db
    .select({
      id: idAgg,
      title: titleAgg,
      agent: agentAgg,
      severity: severityAgg,
      cveId: cveIdAgg,
      cvssScore: cvssScoreTextAgg,
      sourceUrl: urlAgg,
      publishedAt: publishedAtAgg,
      createdAt: createdAtAgg,
      pocCount: pocCountAgg,
    })
    .from(findings)
    .where(whereExpr)
    .groupBy(groupKey)
    .orderBy(orderPrimary, desc(publishedAtAgg), desc(idAgg))
    .limit(limit)
    .offset(offset);

  const rows: FindingRow[] = rowsRaw.map((r) => ({
    id: r.id,
    title: r.title,
    agent: r.agent,
    severity: r.severity ?? "info",
    cveId: r.cveId ?? null,
    cvssScore: r.cvssScore ? String(r.cvssScore) : null,
    sourceUrl: r.sourceUrl ?? null,
    publishedAt: toIsoStringSafe(r.publishedAt),
    createdAt: toIsoStringSafe(r.createdAt),
    pocCount: Number(r.pocCount ?? 0),
  }));

  const current: Record<string, string | undefined> = {
    q: q || undefined,
    agent: agent || undefined,
    severity: severity || undefined,
    sort,
    dir,
    page: String(page),
    limit: String(limit),
  };

  const prevHref =
    page > 1 ? buildHref("/data/findings", current, { page: String(page - 1) }) : null;
  const nextHref =
    rows.length === limit
      ? buildHref("/data/findings", current, { page: String(page + 1) })
      : null;

  const showAgent = AGENTS.includes(agent as never) ? agent : "";
  const showSeverity = SEVERITIES.includes(severity as never) ? severity : "";

  return (
      <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Findings</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Query and sort the complete findings table.
        </p>
      </header>

      <form
        className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        action="/data/findings"
        method="get"
      >
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Search</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="Title or summary…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Agent</div>
          <select
            name="agent"
            defaultValue={showAgent}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Severity</div>
          <select
            name="severity"
            defaultValue={showSeverity}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
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
            href="/data/findings"
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
              <CsvExportButton
                filename="findings.csv"
                rows={rows}
                columns={[
                  { header: "id", key: "id" },
                  { header: "published_at", key: "publishedAt" },
                  { header: "created_at", key: "createdAt" },
                  { header: "agent", key: "agent" },
                  { header: "severity", key: "severity" },
                  { header: "cve_id", key: "cveId" },
                  { header: "cvss_score", key: "cvssScore" },
                  { header: "poc_count", key: "pocCount" },
                  { header: "title", key: "title" },
                  { header: "source_url", key: "sourceUrl" },
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
                    ["publishedAt", "Published"],
                    ["agent", "Agent"],
                    ["severity", "Severity"],
                    ["cvssScore", "CVSS"],
                    ["cveId", "CVE"],
                    ["pocCount", "PoCs"],
                    ["title", "Title"],
                  ].map(([key, label]) => {
                    const nextDir = sortDirForNext(sort, dir, key);
                    const href = buildHref("/data/findings", current, {
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
                    <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                      {r.publishedAt
                        ? new Date(r.publishedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{r.agent}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{r.severity}</td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap">
                      {r.cvssScore ?? "—"}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums">
                      {r.cveId ?? "—"}
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap">{nf(r.pocCount)}</td>
                    <td className="py-3 min-w-[460px]">
                      <div className="flex items-start gap-2">
                        <Link
                          href={`/findings/${r.id}`}
                          className="min-w-0 flex-1 text-zinc-900 dark:text-zinc-100 hover:underline truncate"
                          title={r.title}
                        >
                          {r.title}
                        </Link>
                        {r.sourceUrl ? (
                          <a
                            href={r.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={r.sourceUrl}
                            aria-label="Open source URL"
                            className="shrink-0 rounded p-1 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                          >
                            <ExternalLinkIcon className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>
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
