export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, kgEntities, kgRelations } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { toIsoStringSafe } from "../../../lib/dates";

async function getCountryActors(iso2: string) {
  const db = getDb();
  const rows = await db
    .select({
      actorId: kgRelations.fromId,
      name: kgEntities.name,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .leftJoin(
      kgEntities,
      and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, kgRelations.fromId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_origin_country"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "country"),
        eq(kgRelations.toId, iso2)
      )
    )
    .orderBy(desc(kgRelations.support))
    .limit(250);

  return rows.map((r) => ({
    actorId: r.actorId,
    name: r.name ?? r.actorId,
    support: r.support ?? 0,
    confidence: r.confidence ?? 0,
    lastSeen: toIsoStringSafe(r.lastSeen),
  }));
}

function countryName(iso2: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

export default async function CountryPage({
  params,
}: {
  params: Promise<{ iso2: string }>;
}) {
  const { iso2: rawIso2 } = await params;
  const iso2 = rawIso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) notFound();

  const actors = await getCountryActors(iso2);

  const heat = actors.reduce((sum, a) => sum + (a.support ?? 0), 0);
  const lastSeen = actors.reduce<string | null>((max, a) => {
    if (!a.lastSeen) return max;
    if (!max) return a.lastSeen;
    return a.lastSeen > max ? a.lastSeen : max;
  }, null);

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10 space-y-6">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-200 transition-colors"
        >
          ← Back to globe
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {countryName(iso2)}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="tabular-nums tracking-wide">{iso2}</span>
          <span className="tabular-nums">heat {heat.toFixed(2)}</span>
          {lastSeen ? (
            <span className="tabular-nums">
              last {new Date(lastSeen).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </header>

      <div className="space-y-2">
        {actors.length ? (
          actors.map((a) => (
            <Link
              key={a.actorId}
              href={`/actors/${a.actorId}`}
              className="block bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-900 dark:text-zinc-100">{a.name}</div>
                  <div className="text-xs text-zinc-500 tabular-nums tracking-wide">{a.actorId}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">
                    <div>
                      <span className="text-zinc-600">Score</span>{" "}
                      <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{a.support.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-600">Confidence</span>{" "}
                      <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                        {Math.round(a.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-600">
                    {a.lastSeen ? (
                      <span className="tabular-nums">
                        {new Date(a.lastSeen).toLocaleDateString()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No actor attributions yet.</p>
        )}
      </div>
    </div>
  );
}
