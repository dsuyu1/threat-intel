export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  actorNeighbors,
  getDb,
  kgEntities,
  kgEvidence,
  kgRelations,
} from "@ti/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Pentagraph } from "../../../components/Pentagraph";
import { EvidenceDetails } from "../../../components/EvidenceDetails";
import { SectorWheel } from "../../../components/SectorWheel";
import { Markdown } from "../../../components/ui/Markdown";
import { InfoTip } from "../../../components/ui/InfoTip";
import { toIsoStringSafe } from "../../../lib/dates";

type EvidenceItem = {
  url: string;
  excerpt: string;
  publishedAt: string | null;
  confidence: number;
};

type MitreCitation = { name: string; url?: string | null };

const SUPER_DIGITS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

function toSuperscript(n: number) {
  const s = String(Math.max(0, Math.floor(n)));
  return s
    .split("")
    .map((ch) => SUPER_DIGITS[ch] ?? ch)
    .join("");
}

function normCitationLabel(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function getMitreCitationsFromAttributes(attrs: unknown): MitreCitation[] {
  if (!attrs || typeof attrs !== "object") return [];
  const obj = attrs as any;
  const raw = obj["citations"];
  if (!Array.isArray(raw)) return [];
  const out: MitreCitation[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const name = typeof (c as any).name === "string" ? (c as any).name.trim() : "";
    const url = typeof (c as any).url === "string" ? (c as any).url.trim() : null;
    if (!name) continue;
    out.push({ name, url });
  }
  return out;
}

function formatMitreDescription(params: {
  description: string;
  citations: MitreCitation[];
}) {
  const citationUrlByNorm = new Map<string, string>();
  for (const c of params.citations) {
    if (!c.url) continue;
    citationUrlByNorm.set(normCitationLabel(c.name), c.url);
  }

  const sources: Array<{ index: number; label: string; url?: string }> = [];
  const indexByNorm = new Map<string, number>();

  const text = params.description.replace(/\s*\(Citation:\s*([^)]+?)\)/g, (_m, rawLabel) => {
    const label = String(rawLabel ?? "").trim();
    if (!label) return "";

    const norm = normCitationLabel(label);
    const existing = indexByNorm.get(norm);
    if (existing) return toSuperscript(existing);

    const index = sources.length + 1;
    indexByNorm.set(norm, index);
    sources.push({ index, label, url: citationUrlByNorm.get(norm) });
    return toSuperscript(index);
  });

  return { text: text.trim(), sources };
}

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

  const aliases = (actor.aliases ?? [])
    .map((a) => String(a ?? "").trim())
    .filter(Boolean)
    .filter((a) => a.toLowerCase() !== String(actor.name ?? "").trim().toLowerCase());
  const aliasesUnique: string[] = [];
  const seenAlias = new Set<string>();
  for (const a of aliases) {
    const k = a.toLowerCase();
    if (seenAlias.has(k)) continue;
    seenAlias.add(k);
    aliasesUnique.push(a);
  }
  const aliasesShown = aliasesUnique.slice(0, 6);
  const aliasesRemaining = Math.max(0, aliasesUnique.length - aliasesShown.length);

  const [origins, sectors, techniques, cves, campaigns, neighbors] = await Promise.all([
    getTopRelations({ actorId, type: "actor_origin_country", toKind: "country", limit: 3 }),
    getTopRelations({ actorId, type: "actor_targets_sector", toKind: "sector", limit: 10 }),
    getTopRelations({ actorId, type: "actor_uses_technique", toKind: "technique", limit: 12 }),
    getTopRelations({ actorId, type: "actor_exploits_cve", toKind: "cve", limit: 12 }),
    getTopRelations({ actorId, type: "actor_attributed_campaign", toKind: "campaign", limit: 20 }),
    getNeighbors(actorId),
  ]);

  const mitigations = await getMitigationsFromTechniques(techniques.slice(0, 8).map((t) => t.id));

  const sumSupport = (items: Array<{ support: number }>) =>
    items.reduce((acc, it) => acc + (Number.isFinite(it.support) ? Math.max(0, it.support) : 0), 0);

  const facets = [
    {
      label: "Origin",
      value: origins[0]?.id ?? "\u2014",
      sub: null,
      weight: origins[0]?.support ?? 0,
    },
    {
      label: "Sectors",
      value: sectors.length ? String(sectors.length) : "\u2014",
      sub: "Weighted (decayed support)",
      weight: sumSupport(sectors),
    },
    {
      label: "TTPs",
      value: techniques.length ? String(techniques.length) : "\u2014",
      sub: "Explicit ATT&CK IDs only",
      weight: sumSupport(techniques),
    },
    {
      label: "CVEs",
      value: cves.length ? String(cves.length) : "\u2014",
      sub: "Explicit CVEs only",
      weight: sumSupport(cves),
    },
    {
      label: "Mitigations",
      value: mitigations.length ? String(mitigations.length) : "\u2014",
      sub: "Derived from ATT&CK",
      weight: mitigations.reduce((acc, m) => acc + (Number.isFinite(m.count) ? m.count : 0), 0),
    },
  ];

  const GRAPH_BRANCH_MAX = 10;
  const branches = [
    { items: origins.slice(0, GRAPH_BRANCH_MAX).map((o) => ({ label: o.id, weight: o.support })) },
    { items: sectors.slice(0, GRAPH_BRANCH_MAX).map((s) => ({ label: s.name, weight: s.support })) },
    { items: techniques.slice(0, GRAPH_BRANCH_MAX).map((t) => ({ label: t.id, weight: t.support })) },
    { items: cves.slice(0, GRAPH_BRANCH_MAX).map((c) => ({ label: c.id, weight: c.support })) },
    { items: mitigations.slice(0, GRAPH_BRANCH_MAX).map((m) => ({ label: m.id, weight: m.count })) },
  ];

  const mitreDesc = actor.description
    ? formatMitreDescription({
        description: actor.description,
        citations: getMitreCitationsFromAttributes(actor.attributes),
      })
    : null;

  return (
    <div className="max-w-[1440px] mx-auto px-6 md:px-10 py-10">
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
        {aliasesShown.length ? (
          <p className="text-sm text-zinc-500">
            Also known as{" "}
            <span className="text-zinc-700 dark:text-zinc-300">
              {aliasesShown.join(", ")}
              {aliasesRemaining ? `, and ${aliasesRemaining} more` : ""}
            </span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
          <span className="tabular-nums tracking-wide">{actor.entityId}</span>
          {origins[0] ? (
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-600 dark:text-zinc-500">Origin</span>
              <Link
                href={`/countries/${origins[0].id}`}
                className="text-zinc-900 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {origins[0].name}
              </Link>
              <span className="tabular-nums tracking-wide text-zinc-500">({origins[0].id})</span>
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-10">
        <Pentagraph facets={facets} branches={branches} />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr,0.8fr]">
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
            {mitreDesc?.text ? (
              <>
                <Markdown className="mt-3">{mitreDesc.text}</Markdown>
                {mitreDesc.sources.length ? (
                  <div className="mt-2 text-xs text-zinc-500 leading-snug">
                    <span className="text-zinc-600 dark:text-zinc-500">Sources:</span>{" "}
                    {mitreDesc.sources.map((s, i) => (
                      <span key={s.index} className="inline-flex items-baseline gap-1">
                        <span className="tabular-nums">{toSuperscript(s.index)}</span>
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                          >
                            {s.label}
                          </a>
                        ) : (
                          <span className="text-zinc-700 dark:text-zinc-300">{s.label}</span>
                        )}
                        {i < mitreDesc.sources.length - 1 ? (
                          <span className="px-1 text-zinc-400 dark:text-zinc-600">·</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No MITRE description available yet.</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Campaigns</h2>
                <InfoTip
                  title="MITRE"
                  body="Campaign links are derived from MITRE ATT&CK STIX (campaign attribution relationships)."
                />
              </div>
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
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Mitigations</h2>
                <InfoTip
                  title="ATT&CK"
                  body="Mitigations are derived from MITRE ATT&CK technique ↔ mitigation mappings."
                />
              </div>
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
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Similarities</h2>
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
