export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgRelations } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CsvExportButton } from "../../../../components/ui/CsvExportButton";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { buildHref, clamp, parsePositiveInt } from "../../../../lib/search-params";
import { toIsoStringSafe } from "../../../../lib/dates";

type SortKey = "lastSeen" | "support" | "confidence" | "type";

type SearchParams = {
  q?: string;
  type?: string;
  fromKind?: string;
  toKind?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: string;
  limit?: string;
};

type Row = {
  id: string;
  type: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  support: number;
  confidence: number;
  lastSeen: string | null;
};

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortDirForNext(currentSort: string, currentDir: string, nextSort: string) {
  if (currentSort !== nextSort) return "desc";
  return currentDir === "asc" ? "desc" : "asc";
}

export default async function KgRelationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ? sp.q.trim() : "";
  const type = sp.type?.trim() ? sp.type.trim() : "";
  const fromKind = sp.fromKind?.trim() ? sp.fromKind.trim() : "";
  const toKind = sp.toKind?.trim() ? sp.toKind.trim() : "";

  const page = parsePositiveInt(sp.page, 1);
  const limit = clamp(parsePositiveInt(sp.limit, 25), 10, 100);
  const offset = (page - 1) * limit;

  const sort: SortKey = sp.sort ?? "lastSeen";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const db = getDb();

  const conditions = [];
  if (q) {
    conditions.push(
      sql`${kgRelations.fromId} ilike ${`%${q}%`} or ${kgRelations.toId} ilike ${`%${q}%`}`
    );
  }
  if (type) conditions.push(eq(kgRelations.type, type));
  if (fromKind) conditions.push(eq(kgRelations.fromKind, fromKind));
  if (toKind) conditions.push(eq(kgRelations.toKind, toKind));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol =
    sort === "support"
      ? kgRelations.support
      : sort === "confidence"
        ? kgRelations.confidence
        : sort === "type"
          ? kgRelations.type
          : kgRelations.lastSeen;

  const orderPrimary = dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(kgRelations)
    .where(whereExpr);

  const rowsRaw = await db
    .select({
      id: kgRelations.id,
      type: kgRelations.type,
      fromKind: kgRelations.fromKind,
      fromId: kgRelations.fromId,
      toKind: kgRelations.toKind,
      toId: kgRelations.toId,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .where(whereExpr)
    .orderBy(orderPrimary, desc(kgRelations.lastSeen))
    .limit(limit)
    .offset(offset);

  const rows: Row[] = rowsRaw.map((r) => ({
    id: r.id,
    type: r.type,
    fromKind: r.fromKind,
    fromId: r.fromId,
    toKind: r.toKind,
    toId: r.toId,
    support: Number(r.support ?? 0),
    confidence: Number(r.confidence ?? 0),
    lastSeen: toIsoStringSafe(r.lastSeen),
  }));

  const typeOptionsRaw = await db
    .select({ type: kgRelations.type, count: sql<number>`count(*)` })
    .from(kgRelations)
    .groupBy(kgRelations.type)
    .orderBy(desc(sql`count(*)`))
    .limit(100);
  const typeOptions = typeOptionsRaw.map((t) => t.type);

  const current: Record<string, string | undefined> = {
    q: q || undefined,
    type: type || undefined,
    fromKind: fromKind || undefined,
    toKind: toKind || undefined,
    sort,
    dir,
    page: String(page),
    limit: String(limit),
  };

  const prevHref =
    page > 1 ? buildHref("/data/kg-relations", current, { page: String(page - 1) }) : null;
  const nextHref =
    rows.length === limit
      ? buildHref("/data/kg-relations", current, { page: String(page + 1) })
      : null;

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">KG relations</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Knowledge graph edges.</p>
      </header>

      <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" action="/data/kg-relations" method="get">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Search</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="fromId or toId…"
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
            {typeOptions.slice(0, 50).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">fromKind</div>
          <input
            name="fromKind"
            defaultValue={fromKind}
            placeholder="actor, cve…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">toKind</div>
          <input
            name="toKind"
            defaultValue={toKind}
            placeholder="technique, mitigation…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <div className="flex items-center gap-2 md:col-span-4">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="limit" value={String(limit)} />
          <button className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95">
            Apply
          </button>
          <a
            href="/data/kg-relations"
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
                filename="kg_relations.csv"
                rows={rows}
                columns={[
                  { header: "id", key: "id" },
                  { header: "type", key: "type" },
                  { header: "from_kind", key: "fromKind" },
                  { header: "from_id", key: "fromId" },
                  { header: "to_kind", key: "toKind" },
                  { header: "to_id", key: "toId" },
                  { header: "support", key: "support" },
                  { header: "confidence", key: "confidence" },
                  { header: "last_seen", key: "lastSeen" },
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
                    ["lastSeen", "Last seen"],
                    ["type", "Type"],
                    ["support", "Support"],
                    ["confidence", "Confidence"],
                    ["from", "From"],
                    ["to", "To"],
                  ].map(([key, label]) => {
                    const isSortable = ["lastSeen", "type", "support", "confidence"].includes(key);
                    const nextDir = sortDirForNext(sort, dir, key);
                    const href = buildHref("/data/kg-relations", current, {
                      sort: key,
                      dir: nextDir,
                      page: "1",
                    });
                    const active = sort === key;
                    return (
                      <th key={key} className="py-2 text-left font-medium whitespace-nowrap pr-4">
                        {isSortable ? (
                          <a
                            href={href}
                            className={`hover:underline ${active ? "text-zinc-900 dark:text-zinc-100" : ""}`}
                          >
                            {label}
                            {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
                          </a>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                      {r.lastSeen
                        ? new Date(r.lastSeen).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{r.type}</td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap">{r.support.toFixed(3)}</td>
                    <td className="py-3 pr-4 tabular-nums whitespace-nowrap">{r.confidence.toFixed(3)}</td>
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums">
                      {r.fromKind}:{r.fromId}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums">
                      {r.toKind}:{r.toId}
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
