export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  actorNeighbors,
  documents,
  getDb,
  kgEntities,
  kgEvidence,
  kgRelations,
} from "@ti/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ControlPentagon } from "../../../components/ControlPentagon";
import { EvidenceDetails } from "../../../components/EvidenceDetails";
import { SectorWheel } from "../../../components/SectorWheel";
import { ActorMiniGlobeLazy } from "../../../components/ActorMiniGlobeLazy";
import { Markdown } from "../../../components/ui/Markdown";
import { iso2ToLngLat } from "../../../lib/country-coords";
import { toIsoStringSafe } from "../../../lib/dates";

type EvidenceItem = {
  url: string;
  excerpt: string;
  publishedAt: string | null;
  confidence: number;
};

async function fetchEvidenceByRelationIds(
  relationIds: string[],
  maxPerRelation = 4
): Promise<Map<string, EvidenceItem[]>> {
  const out = new Map<string, EvidenceItem[]>();
  if (relationIds.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select({
      relationId: kgEvidence.relationId,
      excerpt: kgEvidence.excerpt,
      url: kgEvidence.url,
      publishedAt: kgEvidence.publishedAt,
      confidence: kgEvidence.confidence,
    })
    .from(kgEvidence)
    .where(inArray(kgEvidence.relationId, relationIds))
    .orderBy(desc(kgEvidence.createdAt))
    .limit(250);

  for (const r of rows) {
    const list = out.get(r.relationId) ?? [];
    if (list.length >= maxPerRelation) continue;
    list.push({
      url: r.url,
      excerpt: r.excerpt,
      publishedAt: toIsoStringSafe(r.publishedAt),
      confidence: r.confidence ?? 0,
    });
    out.set(r.relationId, list);
  }

  return out;
}

async function getActor(actorId: string) {
  const db = getDb();
  const [actor] = await db
    .select()
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, actorId)))
    .limit(1);
  return actor ?? null;
}

async function getTopRelations(params: {
  actorId: string;
  type: string;
  toKind: string;
  limit: number;
}) {
  const db = getDb();
  const rows = await db
    .select({
      relationId: kgRelations.id,
      toId: kgRelations.toId,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      name: kgEntities.name,
      description: kgEntities.description,
    })
    .from(kgRelations)
    .leftJoin(
      kgEntities,
      and(eq(kgEntities.kind, params.toKind), eq(kgEntities.entityId, kgRelations.toId))
    )
    .where(
      and(
        eq(kgRelations.type, params.type),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.fromId, params.actorId),
        eq(kgRelations.toKind, params.toKind)
      )
    )
    .orderBy(desc(kgRelations.support))
    .limit(params.limit);

  const evidenceByRel = await fetchEvidenceByRelationIds(rows.map((r) => r.relationId));

  return rows.map((r) => ({
    id: r.toId,
    name: r.name ?? r.toId,
    description: r.description ?? null,
    support: r.support ?? 0,
    confidence: r.confidence ?? 0,
    evidence: evidenceByRel.get(r.relationId) ?? [],
  }));
}

async function getMitigationsFromTechniques(techniqueIds: string[]) {
  if (techniqueIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      relationId: kgRelations.id,
      techniqueId: kgRelations.fromId,
      mitigationId: kgRelations.toId,
      mitigationName: kgEntities.name,
      confidence: kgRelations.confidence,
      support: kgRelations.support,
    })
    .from(kgRelations)
    .leftJoin(
      kgEntities,
      and(eq(kgEntities.kind, "mitigation"), eq(kgEntities.entityId, kgRelations.toId))
    )
    .where(
      and(
        eq(kgRelations.type, "technique_mitigated_by"),
        eq(kgRelations.fromKind, "technique"),
        eq(kgRelations.toKind, "mitigation"),
        inArray(kgRelations.fromId, techniqueIds)
      )
    )
    .orderBy(desc(kgRelations.support))
    .limit(200);

  const byMit = new Map<
    string,
    { id: string; name: string; count: number; relationIds: string[] }
  >();

  for (const r of rows) {
    const cur = byMit.get(r.mitigationId) ?? {
      id: r.mitigationId,
      name: r.mitigationName ?? r.mitigationId,
      count: 0,
      relationIds: [],
    };
    cur.count += 1;
    cur.relationIds.push(r.relationId);
    byMit.set(r.mitigationId, cur);
  }

  const mitigations = Array.from(byMit.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const evidenceByRel = await fetchEvidenceByRelationIds(
    mitigations.flatMap((m) => m.relationIds),
    2
  );

  return mitigations.map((m) => ({
    id: m.id,
    name: m.name,
    count: m.count,
    evidence: m.relationIds.flatMap((rid) => evidenceByRel.get(rid) ?? []).slice(0, 4),
  }));
}

async function getNeighbors(actorId: string) {
  const db = getDb();
  const rows = await db
    .select({
      neighborActorId: actorNeighbors.neighborActorId,
      distance: actorNeighbors.distance,
      whyJson: actorNeighbors.whyJson,
    })
    .from(actorNeighbors)
    .where(eq(actorNeighbors.actorId, actorId))
    .orderBy(actorNeighbors.distance)
    .limit(12);

  const neighborIds = rows.map((r) => r.neighborActorId);
  const names =
    neighborIds.length > 0
      ? await db
          .select({ id: kgEntities.entityId, name: kgEntities.name })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "actor"), inArray(kgEntities.entityId, neighborIds)))
      : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  return rows.map((r) => ({
    actorId: r.neighborActorId,
    name: nameById.get(r.neighborActorId) ?? r.neighborActorId,
    distance: r.distance,
    why: (r.whyJson ?? null) as unknown,
  }));
}

export default async function ActorPage({
  params,
}: {
  params: Promise<{ actorId: string }>;
}) {
  const { actorId } = await params;
  const actor = await getActor(actorId);
  if (!actor) notFound();

  const [origins, sectors, techniques, cves, campaigns, neighbors] = await Promise.all([
    getTopRelations({ actorId, type: "actor_origin_country", toKind: "country", limit: 3 }),
    getTopRelations({ actorId, type: "actor_targets_sector", toKind: "sector", limit: 10 }),
    getTopRelations({ actorId, type: "actor_uses_technique", toKind: "technique", limit: 12 }),
    getTopRelations({ actorId, type: "actor_exploits_cve", toKind: "cve", limit: 12 }),
    getTopRelations({ actorId, type: "actor_attributed_campaign", toKind: "campaign", limit: 20 }),
    getNeighbors(actorId),
  ]);

  const topOrigin = origins[0]?.id ?? null;
  const lngLat = topOrigin ? iso2ToLngLat(topOrigin) : null;

  const mitigations = await getMitigationsFromTechniques(techniques.slice(0, 8).map((t) => t.id));

  const facets = [
    {
      label: "Origin",
      value: origins[0]?.id ?? "\u2014",
      sub: null,
    },
    {
      label: "Sectors",
      value: sectors.length ? String(sectors.length) : "\u2014",
      sub: "Weighted (decayed support)",
    },
    {
      label: "TTPs",
      value: techniques.length ? String(techniques.length) : "\u2014",
      sub: "Explicit ATT&CK IDs only",
    },
    {
      label: "CVEs",
      value: cves.length ? String(cves.length) : "\u2014",
      sub: "Explicit CVEs only",
    },
    {
      label: "Mitigations",
      value: mitigations.length ? String(mitigations.length) : "\u2014",
      sub: "Derived from ATT&CK",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
      <header className="space-y-3">
        <Link
          href="/actors"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-200 transition-colors"
        >
          <span aria-hidden="true">&larr;</span>
          Back to actors
        </Link>
        <h1 className="text-3xl md:text-4xl font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
          {actor.name}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
          <span className="tabular-nums tracking-wide">{actor.entityId}</span>
          {actor.aliases?.length ? <span>{actor.aliases.length} aliases</span> : null}
        </div>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-10">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">MITRE</h2>
              <a
                href={`https://attack.mitre.org/groups/${actor.entityId}/`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                attack.mitre.org <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
            {actor.description ? (
              <Markdown className="mt-3">{actor.description}</Markdown>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No MITRE description available yet.</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Campaigns</h2>
              <span className="text-xs text-zinc-500">MITRE-derived</span>
            </div>
            {campaigns.length ? (
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-900/80 rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
                {campaigns.map((c) => (
                  <li key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-base font-medium text-zinc-900 dark:text-zinc-100">{c.name}</div>
                        <div className="text-xs text-zinc-500 tabular-nums tracking-wide">{c.id}</div>
                      </div>
                      <a
                        href={`https://attack.mitre.org/campaigns/${c.id}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        MITRE <span aria-hidden="true">&rarr;</span>
                      </a>
                    </div>
                    {c.description ? (
                      <Markdown className="mt-2 text-xs text-zinc-400">{c.description}</Markdown>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No campaigns mapped yet.</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Mitigations</h2>
              <span className="text-xs text-zinc-500">from ATT&amp;CK</span>
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              Derived by mapping the actor&apos;s top techniques to MITRE ATT&amp;CK mitigations.
            </p>
            {mitigations.length ? (
              <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-900/80 rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
                {mitigations.map((m) => (
                  <div key={m.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-base font-medium text-zinc-900 dark:text-zinc-100">{m.name}</div>
                      <span className="text-xs text-zinc-500 tabular-nums tracking-wide">
                        {m.id} <span aria-hidden="true">&middot;</span> {m.count}
                      </span>
                    </div>
                    <EvidenceDetails evidence={m.evidence} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No mitigations mapped yet.</p>
            )}
          </section>
        </div>

        <div className="space-y-10">
          <ControlPentagon facets={facets} />

          {lngLat ? (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Origin</h2>
              <ActorMiniGlobeLazy
                lng={lngLat[0]}
                lat={lngLat[1]}
                label={topOrigin ?? "Origin"}
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Target Sectors</h2>
            <SectorWheel
              sectors={sectors.map((s) => ({
                id: s.id,
                label: s.name,
                weight: s.support,
              }))}
            />
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Similarity</h2>
              <span className="text-xs text-zinc-500">offline neighbors</span>
            </div>
            {neighbors.length ? (
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-900/80 rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
                {neighbors.map((n) => (
                  <li key={n.actorId} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/actors/${n.actorId}`}
                        className="text-base font-medium text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                      >
                        {n.name}
                      </Link>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {n.distance.toFixed(3)}
                      </span>
                    </div>
                    {n.why ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                          Why?
                        </summary>
                        <pre className="mt-2 text-xs text-zinc-600 dark:text-zinc-500 bg-zinc-100 dark:bg-black/40 border border-zinc-200 dark:border-zinc-900/80 rounded-lg p-3 overflow-auto">
                          {JSON.stringify(n.why, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No neighbors computed yet.</p>
            )}
          </section>
        </div>
      </div>

      <section className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FacetCard title="Origin Countries" items={origins} />
        <FacetCard title="Target Sectors (Evidence)" items={sectors} />
        <FacetCard title="Top TTPs (ATT&CK)" items={techniques} />
        <FacetCard title="Top CVEs" items={cves} />
      </section>
    </div>
  );
}

function FacetCard({
  title,
  items,
}: {
  title: string;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    support: number;
    confidence: number;
    evidence: EvidenceItem[];
  }>;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>

      {items.length ? (
        <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-900/80">
          {items.map((it) => (
            <div key={it.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-base font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.name}</div>
                  <div className="text-xs text-zinc-500 tabular-nums tracking-wide">{it.id}</div>
                </div>
                <div className="text-right text-xs text-zinc-500 shrink-0">
                  <div>
                    <span className="text-zinc-600">Score</span>{" "}
                    <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">Confidence</span>{" "}
                    <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                      {Math.round(it.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {it.description ? (
                <Markdown className="mt-2 text-xs text-zinc-400">{it.description}</Markdown>
              ) : null}
              <EvidenceDetails evidence={it.evidence} />
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-zinc-500">No data yet.</p>
      )}
    </section>
  );
}
