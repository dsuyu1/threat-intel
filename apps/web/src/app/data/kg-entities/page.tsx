export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgEntities } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CsvExportButton } from "../../../components/ui/CsvExportButton";
import { Card, CardContent, CardHeader } from "../../../components/ui/Card";
import { buildHref, clamp, parsePositiveInt } from "../../../lib/search-params";
import { toIsoStringSafe } from "../../../lib/dates";

type SortKey = "updatedAt" | "kind" | "name" | "entityId";

type SearchParams = {
  q?: string;
  kind?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: string;
  limit?: string;
};

type Row = {
  kind: string;
  entityId: string;
  name: string;
  updatedAt: string | null;
};

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortDirForNext(currentSort: string, currentDir: string, nextSort: string) {
  if (currentSort !== nextSort) return "asc";
  return currentDir === "asc" ? "desc" : "asc";
}

export default async function KgEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ? sp.q.trim() : "";
  const kind = sp.kind?.trim() ? sp.kind.trim() : "";

  const page = parsePositiveInt(sp.page, 1);
  const limit = clamp(parsePositiveInt(sp.limit, 25), 10, 100);
  const offset = (page - 1) * limit;

  const sort: SortKey = sp.sort ?? "updatedAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const db = getDb();

  const conditions = [];
  if (q) conditions.push(sql`${kgEntities.name} ilike ${`%${q}%`} or ${kgEntities.entityId} ilike ${`%${q}%`}`);
  if (kind) conditions.push(eq(kgEntities.kind, kind));
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol =
    sort === "kind"
      ? kgEntities.kind
      : sort === "name"
        ? kgEntities.name
        : sort === "entityId"
          ? kgEntities.entityId
          : kgEntities.updatedAt;

  const orderPrimary = dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(kgEntities)
    .where(whereExpr);

  const rowsRaw = await db
    .select({
      kind: kgEntities.kind,
      entityId: kgEntities.entityId,
      name: kgEntities.name,
      updatedAt: kgEntities.updatedAt,
    })
    .from(kgEntities)
    .where(whereExpr)
    .orderBy(orderPrimary, asc(kgEntities.kind), asc(kgEntities.name))
    .limit(limit)
    .offset(offset);

  const rows: Row[] = rowsRaw.map((r) => ({
    kind: r.kind,
    entityId: r.entityId,
    name: r.name,
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  const kindOptionsRaw = await db
    .select({ kind: kgEntities.kind, count: sql<number>`count(*)` })
    .from(kgEntities)
    .groupBy(kgEntities.kind)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  const kindOptions = kindOptionsRaw.map((k) => k.kind);

  const current: Record<string, string | undefined> = {
    q: q || undefined,
    kind: kind || undefined,
    sort,
    dir,
    page: String(page),
    limit: String(limit),
  };

  const prevHref =
    page > 1 ? buildHref("/data/kg-entities", current, { page: String(page - 1) }) : null;
  const nextHref =
    rows.length === limit
      ? buildHref("/data/kg-entities", current, { page: String(page + 1) })
      : null;

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">KG entities</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Knowledge graph nodes.</p>
      </header>

      <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" action="/data/kg-entities" method="get">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Search</div>
          <input
            name="q"
            defaultValue={q}
            placeholder="Name or ID…"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Kind</div>
          <select
            name="kind"
            defaultValue={kind}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="">All</option>
            {kindOptions.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
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
            href="/data/kg-entities"
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
                filename="kg_entities.csv"
                rows={rows}
                columns={[
                  { header: "kind", key: "kind" },
                  { header: "entity_id", key: "entityId" },
                  { header: "name", key: "name" },
                  { header: "updated_at", key: "updatedAt" },
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
                    ["kind", "Kind"],
                    ["entityId", "Entity ID"],
                    ["name", "Name"],
                    ["updatedAt", "Updated"],
                  ].map(([key, label]) => {
                    const nextDir = sortDirForNext(sort, dir, key);
                    const href = buildHref("/data/kg-entities", current, {
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
                  <tr key={`${r.kind}:${r.entityId}`} className="align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">{r.kind}</td>
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums">{r.entityId}</td>
                    <td className="py-3 pr-4 min-w-[360px] text-zinc-900 dark:text-zinc-100">{r.name}</td>
                    <td className="py-3 pr-4 whitespace-nowrap tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
                      {r.updatedAt
                        ? new Date(r.updatedAt).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" })
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
