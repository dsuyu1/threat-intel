export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, documents } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CsvExportButton } from "../../../components/ui/CsvExportButton";
import { Card, CardContent, CardHeader } from "../../../components/ui/Card";
import { buildHref, clamp, parsePositiveInt } from "../../../lib/search-params";
import { toIsoStringSafe } from "../../../lib/dates";

type SortKey = "fetchedAt" | "publishedAt" | "createdAt" | "status" | "url" | "title";

type SearchParams = {
  q?: string;
  status?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: string;
  limit?: string;
};

type Row = {
  id: string;
  url: string;
  title: string | null;
  status: string;
  error: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  createdAt: string | null;
};

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortDirForNext(currentSort: string, currentDir: string, nextSort: string) {
  if (currentSort !== nextSort) return "desc";
  return currentDir === "asc" ? "desc" : "asc";
}

export default async function DocumentsTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ? sp.q.trim() : "";
  const status = sp.status?.trim() ? sp.status.trim() : "";

  const page = parsePositiveInt(sp.page, 1);
  const limit = clamp(parsePositiveInt(sp.limit, 25), 10, 100);
  const offset = (page - 1) * limit;

  const sort: SortKey = sp.sort ?? "fetchedAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const db = getDb();

  const conditions = [];
  if (q) conditions.push(sql`${documents.url} ilike ${`%${q}%`} or ${documents.title} ilike ${`%${q}%`}`);
  if (status) conditions.push(eq(documents.status, status as never));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol =
    sort === "publishedAt"
      ? documents.publishedAt
      : sort === "createdAt"
        ? documents.createdAt
        : sort === "status"
          ? documents.status
          : sort === "url"
            ? documents.url
            : sort === "title"
              ? documents.title
              : documents.fetchedAt;

  const orderPrimary = dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(documents)
    .where(whereExpr);

  const rowsRaw = await db
    .select({
      id: documents.id,
      url: documents.url,
      title: documents.title,
      status: documents.status,
      error: documents.error,
      publishedAt: documents.publishedAt,
      fetchedAt: documents.fetchedAt,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(whereExpr)
    .orderBy(orderPrimary, desc(documents.fetchedAt))
    .limit(limit)
    .offset(offset);

  const rows: Row[] = rowsRaw.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title ?? null,
    status: r.status,
    error: r.error ?? null,
    publishedAt: toIsoStringSafe(r.publishedAt),
    fetchedAt: toIsoStringSafe(r.fetchedAt),
    createdAt: toIsoStringSafe(r.createdAt),
  }));

  const current: Record<string, string | undefined> = {
    q: q || undefined,
    status: status || undefined,
    sort,
    dir,
    page: String(page),
    limit: String(limit),
  };

  const prevHref =
    page > 1 ? buildHref("/data/documents", current, { page: String(page - 1) }) : null;
  const nextHref =
    rows.length === limit
      ? buildHref("/data/documents", current, { page: String(page + 1) })
      : null;

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Documents</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Raw ingested pages and parsing status.
        </p>
      </header>

      <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" action="/data/documents" method="get">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Search</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="Title or URL…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Status</div>
          <select
            name="status"
            defaultValue={status}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            <option value="ok">ok</option>
            <option value="error">error</option>
          </select>
        </label>

        <div className="flex items-center gap-2 md:col-span-2">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="limit" value={String(limit)} />
          <button className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95">
            Apply
          </button>
          <a
            href="/data/documents"
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
                filename="documents.csv"
                rows={rows}
                columns={[
                  { header: "id", key: "id" },
                  { header: "url", key: "url" },
                  { header: "title", key: "title" },
                  { header: "status", key: "status" },
                  { header: "published_at", key: "publishedAt" },
                  { header: "fetched_at", key: "fetchedAt" },
                  { header: "created_at", key: "createdAt" },
                  { header: "error", key: "error" },
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
                    ["status", "Status"],
                    ["title", "Title"],
                    ["publishedAt", "Published"],
                    ["fetchedAt", "Fetched"],
                    ["url", "URL"],
                    ["createdAt", "Created"],
                  ].map(([key, label]) => {
                    const nextDir = sortDirForNext(sort, dir, key);
                    const href = buildHref("/data/documents", current, {
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
                      <span
                        className={`inline-flex items-center gap-2 text-sm ${r.status === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}
                      >
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${r.status === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}
                          aria-hidden="true"
                        />
                        {r.status}
                      </span>
                      {r.status !== "ok" && r.error ? (
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 max-w-[320px]">
                          {r.error}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 min-w-[380px] text-zinc-900 dark:text-zinc-100">
                      {r.title ?? "—"}
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.publishedAt
                        ? new Date(r.publishedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.fetchedAt
                        ? new Date(r.fetchedAt).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 min-w-[520px]">
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline text-zinc-700 dark:text-zinc-300">
                        {r.url}
                      </a>
                    </td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                        : "—"}
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
