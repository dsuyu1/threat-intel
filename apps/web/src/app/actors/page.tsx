export const runtime = "edge";

import Link from "next/link";
import { getDb, kgEntities, kgRelations } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";

async function getActors(q: string | null) {
  const db = getDb();
  const where = q
    ? and(eq(kgEntities.kind, "actor"), sql`${kgEntities.name} ilike ${`%${q}%`}`)
    : eq(kgEntities.kind, "actor");

  const rows = await db
    .select({
      actorId: kgEntities.entityId,
      name: kgEntities.name,
      lastSeen: sql<Date | null>`max(${kgRelations.lastSeen})`,
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

  return rows;
}

export default async function ActorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const rows = await getActors(q?.trim() ? q.trim() : null);

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Actors</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-500">
          Evidence-first actor profiles (origin, sectors, TTPs, CVEs, mitigations).
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

      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.actorId}
            href={`/actors/${r.actorId}`}
            className="block bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-zinc-900 dark:text-zinc-100">{r.name}</div>
                <div className="text-xs text-zinc-500 tracking-wide tabular-nums">{r.actorId}</div>
              </div>
              <div className="text-xs text-zinc-500">
                {r.lastSeen ? (
                  <>
                    active{" "}
                    <span className="tabular-nums">
                      {new Date(r.lastSeen).toLocaleDateString()}
                    </span>
                  </>
                ) : (
                  "no activity yet"
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
