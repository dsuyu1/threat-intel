export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  actorNeighbors,
  getDb,
  kgEntities,
  kgEvidence,
  kgRelations,
} from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Pentagraph } from "../../../components/Pentagraph";
import { EvidenceDetails } from "../../../components/EvidenceDetails";
import { SectorWheel } from "../../../components/SectorWheel";
import { SimilaritySpokes } from "../../../components/SimilaritySpokes";
import { Markdown } from "../../../components/ui/Markdown";
import { InfoTip } from "../../../components/ui/InfoTip";
import { ActorIcon } from "../../../components/ui/ActorIcon";
import { CsvExportButton } from "../../../components/ui/CsvExportButton";
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
      attributes: kgEntities.attributes,
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
    attributes: (r.attributes ?? null) as unknown,
    support: r.support ?? 0,
    confidence: r.confidence ?? 0,
    evidence: evidenceByRel.get(r.relationId) ?? [],
  }));
}

async function getActorFacetCounts(actorId: string) {
  const db = getDb();

  const [base] = await db
    .select({
      ttpCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_uses_technique' and ${kgRelations.toKind} = 'technique' then ${kgRelations.toId} end)`,
      sectorCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_targets_sector' and ${kgRelations.toKind} = 'sector' then ${kgRelations.toId} end)`,
      cveCount: sql<number>`count(distinct case when ${kgRelations.type} = 'actor_exploits_cve' and ${kgRelations.toKind} = 'cve' then ${kgRelations.toId} end)`,
    })
    .from(kgRelations)
    .where(and(eq(kgRelations.fromKind, "actor"), eq(kgRelations.fromId, actorId)));

  const a2t = alias(kgRelations, "a2t");
  const t2m = alias(kgRelations, "t2m");

  const [mit] = await db
    .select({
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
        eq(a2t.fromId, actorId)
      )
    );

  return {
    ttpCount: Number(base?.ttpCount ?? 0),
    sectorCount: Number(base?.sectorCount ?? 0),
    cveCount: Number(base?.cveCount ?? 0),
    mitigationCount: Number(mit?.mitigationCount ?? 0),
  };
}

async function getTopMitigationsForActor(actorId: string) {
  const db = getDb();
  const a2t = alias(kgRelations, "a2t");
  const t2m = alias(kgRelations, "t2m");

  const top = await db
    .select({
      id: t2m.toId,
      name: kgEntities.name,
      count: sql<number>`count(*)`,
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
    .leftJoin(kgEntities, and(eq(kgEntities.kind, "mitigation"), eq(kgEntities.entityId, t2m.toId)))
    .where(
      and(
        eq(a2t.type, "actor_uses_technique"),
        eq(a2t.fromKind, "actor"),
        eq(a2t.toKind, "technique"),
        eq(a2t.fromId, actorId)
      )
    )
    .groupBy(t2m.toId, kgEntities.name)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const mitigationIds = top.map((t) => t.id);
  if (mitigationIds.length === 0) return [];

  const relRows = await db
    .select({
      relationId: t2m.id,
      mitigationId: t2m.toId,
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
        eq(a2t.fromId, actorId),
        inArray(t2m.toId, mitigationIds)
      )
    )
    .orderBy(desc(t2m.support))
    .limit(300);

  const relIdsByMit = new Map<string, string[]>();
  for (const r of relRows) {
    const cur = relIdsByMit.get(r.mitigationId) ?? [];
    if (cur.length >= 8) continue;
    cur.push(r.relationId);
    relIdsByMit.set(r.mitigationId, cur);
  }

  const evidenceByRel = await fetchEvidenceByRelationIds(relRows.map((r) => r.relationId), 2);

  return top.map((m) => {
    const relIds = relIdsByMit.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.name ?? m.id,
      count: Number(m.count ?? 0),
      evidence: relIds.flatMap((rid) => evidenceByRel.get(rid) ?? []).slice(0, 4),
    };
  });
}

async function getAllMitigationsForActor(actorId: string) {
  const db = getDb();
  const a2t = alias(kgRelations, "a2t");
  const t2m = alias(kgRelations, "t2m");

  const rows = await db
    .select({
      id: t2m.toId,
      name: kgEntities.name,
      count: sql<number>`count(*)`,
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
    .leftJoin(kgEntities, and(eq(kgEntities.kind, "mitigation"), eq(kgEntities.entityId, t2m.toId)))
    .where(
      and(
        eq(a2t.type, "actor_uses_technique"),
        eq(a2t.fromKind, "actor"),
        eq(a2t.toKind, "technique"),
        eq(a2t.fromId, actorId)
      )
    )
    .groupBy(t2m.toId, kgEntities.name)
    .orderBy(desc(sql`count(*)`), asc(t2m.toId))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? r.id,
    count: Number(r.count ?? 0),
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

function formatShownOfTotal(shown: number, total: number | null | undefined) {
  const tRaw = Number(total);
  if (!Number.isFinite(tRaw)) return String(shown);
  const t = Math.max(0, Math.floor(tRaw));
  if (t === 0) return "0";
  if (shown >= t) return String(t);
  return `${shown} / ${t}`;
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

  const [
    origins,
    sectorsTop,
    sectorsAll,
    techniques,
    cves,
    campaigns,
    neighbors,
    facetCounts,
    mitigationsTop,
    mitigationsAll,
  ] = await Promise.all([
    getTopRelations({ actorId, type: "actor_origin_country", toKind: "country", limit: 3 }),
    getTopRelations({ actorId, type: "actor_targets_sector", toKind: "sector", limit: 10 }),
    getTopRelations({ actorId, type: "actor_targets_sector", toKind: "sector", limit: 200 }),
    getTopRelations({ actorId, type: "actor_uses_technique", toKind: "technique", limit: 12 }),
    getTopRelations({ actorId, type: "actor_exploits_cve", toKind: "cve", limit: 12 }),
    getTopRelations({ actorId, type: "actor_attributed_campaign", toKind: "campaign", limit: 20 }),
    getNeighbors(actorId),
    getActorFacetCounts(actorId),
    getTopMitigationsForActor(actorId),
    getAllMitigationsForActor(actorId),
  ]);

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
      value: String(facetCounts.sectorCount),
      sub: "Weighted (decayed support)",
      weight: sumSupport(sectorsAll),
    },
    {
      label: "TTPs",
      value: String(facetCounts.ttpCount),
      sub: "Explicit ATT&CK IDs only",
      weight: sumSupport(techniques),
    },
    {
      label: "CVEs",
      value: String(facetCounts.cveCount),
      sub: "Explicit CVEs only",
      weight: sumSupport(cves),
    },
    {
      label: "Mitigations",
      value: String(facetCounts.mitigationCount),
      sub: "Derived from ATT&CK",
      weight: mitigationsAll.reduce((acc, m) => acc + (Number.isFinite(m.count) ? m.count : 0), 0),
    },
  ];

  const GRAPH_BRANCH_MAX = 10;
  const branches = [
    { items: origins.slice(0, GRAPH_BRANCH_MAX).map((o) => ({ label: o.id, weight: o.support })) },
    { items: sectorsTop.slice(0, GRAPH_BRANCH_MAX).map((s) => ({ label: s.name, weight: s.support })) },
    { items: techniques.slice(0, GRAPH_BRANCH_MAX).map((t) => ({ label: t.id, weight: t.support })) },
    { items: cves.slice(0, GRAPH_BRANCH_MAX).map((c) => ({ label: c.id, weight: c.support })) },
    {
      items: mitigationsTop
        .slice(0, GRAPH_BRANCH_MAX)
        .map((m) => ({ label: m.id, weight: m.count })),
    },
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/actors"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-200 transition-colors"
          >
            <span aria-hidden="true">&larr;</span>
            Back to actors
          </Link>
          <Link
            href={`/actors?view=graph&focus=${encodeURIComponent(actor.entityId)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
          >
            Open relationship graph <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="flex items-start gap-4">
          <ActorIcon
            seed={actor.entityId}
            size={54}
            title={actor.name}
            className="shrink-0 mt-1"
          />
          <div className="min-w-0 space-y-2">
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
                  <span className="tabular-nums tracking-wide text-zinc-500">
                    ({origins[0].id})
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-10">
        <Pentagraph facets={facets} branches={branches} />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-10">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">MITRE</h1>
              <a
                href={`https://attack.mitre.org/groups/${actor.entityId}/`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                MITRE <span aria-hidden="true">&rarr;</span>
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
                 <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Campaigns</h1>
                <InfoTip
                  title="MITRE"
                  body="Campaign links are pulled from MITRE ATT&CK campaign pages (and mapped to groups)."
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

          <div className="space-y-6">
            <section>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Mitigations</h1>
                  <InfoTip
                    title="ATT&CK"
                    body="Mitigations are derived from MITRE ATT&CK technique ↔ mitigation mappings."
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm text-zinc-500 tabular-nums">
                    {formatShownOfTotal(mitigationsTop.length, facetCounts.mitigationCount)}
                  </span>
                  <CsvExportButton
                    filename={`actor-${actorId}-mitigations.csv`}
                    rows={mitigationsAll}
                    columns={[
                      { header: "mitigation_id", key: "id" },
                      { header: "mitigation_name", key: "name" },
                      { header: "technique_count", key: "count" },
                    ]}
                  />
                </div>
              </div>

              <p className="mt-2 text-sm text-zinc-500">
                Derived by mapping the actor&apos;s techniques to MITRE ATT&amp;CK mitigations.
              </p>

              {mitigationsTop.length ? (
                <>
                  <MitigationBars items={mitigationsTop} />

                  {mitigationsAll.length > mitigationsTop.length ? (
                    <details className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
                      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            Show all mitigations
                          </div>
                          <div className="text-xs text-zinc-500 tabular-nums">
                            {Math.min(mitigationsAll.length, facetCounts.mitigationCount)} total
                          </div>
                        </div>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-900/80">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white/90 dark:bg-black/70">
                              <tr className="text-left text-xs text-zinc-600 dark:text-zinc-400">
                                <th className="px-3 py-2 font-medium">Mitigation</th>
                                <th className="px-3 py-2 font-medium">ID</th>
                                <th className="px-3 py-2 font-medium text-right">Techniques</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900/80">
                              {mitigationsAll.map((m) => (
                                <tr key={m.id} className="text-zinc-900 dark:text-zinc-100">
                                  <td className="px-3 py-2">{m.name}</td>
                                  <td className="px-3 py-2 text-xs text-zinc-500 tabular-nums">{m.id}</td>
                                  <td className="px-3 py-2 text-right text-zinc-500 tabular-nums">{m.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">No mitigations mapped yet.</p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Target Sectors</h1>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm text-zinc-500 tabular-nums">
                    {formatShownOfTotal(sectorsTop.length, facetCounts.sectorCount)}
                  </span>
                  <CsvExportButton
                    filename={`actor-${actorId}-target-sectors.csv`}
                    rows={sectorsAll}
                    columns={[
                      { header: "sector_id", key: "id" },
                      { header: "sector_name", key: "name" },
                      { header: "support", key: "support" },
                      { header: "confidence", key: "confidence" },
                      { header: "evidence_count", key: "evidence.length" },
                    ]}
                  />
                </div>
              </div>

              <SectorWheel
                sectors={sectorsTop.map((s) => ({
                  id: s.id,
                  label: s.name,
                  weight: s.support,
                }))}
              />

              {!sectorsAll.length ? (
                <p className="text-sm text-zinc-500">
                  No sector attributions yet. This fills in as RSS reports are ingested and parsed.
                </p>
              ) : sectorsAll.length > sectorsTop.length ? (
                <details className="rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
                  <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Show all sectors
                      </div>
                      <div className="text-xs text-zinc-500 tabular-nums">
                        {Math.min(sectorsAll.length, facetCounts.sectorCount)} total
                      </div>
                    </div>
                  </summary>
                  <div className="px-4 pb-4">
                    <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-900/80">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white/90 dark:bg-black/70">
                          <tr className="text-left text-xs text-zinc-600 dark:text-zinc-400">
                            <th className="px-3 py-2 font-medium">Sector</th>
                            <th className="px-3 py-2 font-medium text-right">Support</th>
                            <th className="px-3 py-2 font-medium text-right">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900/80">
                          {sectorsAll.map((s) => (
                            <tr key={s.id} className="text-zinc-900 dark:text-zinc-100">
                              <td className="px-3 py-2">{s.name}</td>
                              <td className="px-3 py-2 text-right text-zinc-500 tabular-nums">
                                {Math.round(s.support)}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-500 tabular-nums">
                                {Math.round(s.confidence * 100)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ) : null}
            </section>
          </div>
        </div>

        <div className="space-y-10">
          <section>
            <SimilaritySpokes center={{ actorId: actor.entityId, name: actor.name }} neighbors={neighbors} />
          </section>
        </div>
      </div>

      <section className="mt-10 space-y-4">
        <TopTtpSection items={techniques} totalCount={facetCounts.ttpCount} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <FacetCard title="Origins" items={origins} />
          </div>
          <div className="space-y-4">
            <FacetRow title="Top CVEs" items={cves} totalCount={facetCounts.cveCount} />
          </div>
        </div>
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
    attributes?: unknown;
    support: number;
    confidence: number;
    evidence: EvidenceItem[];
  }>;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
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
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      Score
                      <InfoTip
                        title="Score"
                        body="A decayed support score for this relationship. Each observation adds (source reliability × extraction confidence). Older observations decay with a 30‑day half‑life."
                      />
                    </span>{" "}
                    <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      Confidence
                      <InfoTip
                        title="Confidence"
                        body="How sure we are the relationship is real (0–100%). This is the highest confidence seen in evidence, not how often it appears."
                      />
                    </span>{" "}
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

function FacetRow({
  title,
  items,
  autoScroll,
  totalCount,
}: {
  title: string;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    attributes?: unknown;
    support: number;
    confidence: number;
    evidence: EvidenceItem[];
  }>;
  autoScroll?: boolean;
  totalCount?: number;
}) {
  if (autoScroll) {
    return (
      <details className="ttprow group rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
        <style>{`
          @keyframes facet-row-marquee {
            from { transform: translateX(-50%); }
            to   { transform: translateX(0); }
          }
          details.ttprow[open] .ttprow-marquee { display: none; }
          details.ttprow:not([open]) .ttprow-full { display: none; }
          @media (prefers-reduced-motion: reduce) {
            .facet-row-marquee { animation: none !important; transform: none !important; }
          }
        `}</style>

        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none px-4 pt-4">
          <div className="flex items-baseline justify-between gap-4">
             <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-zinc-500 tabular-nums">{formatShownOfTotal(items.length, totalCount)}</span>
              <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
                Expand
                <span className="text-zinc-500 group-open:rotate-180 transition-transform" aria-hidden="true">
                  ▾
                </span>
              </span>
            </div>
          </div>
        </summary>

        {items.length ? (
          <>
            {/* Closed: slow infinite marquee (duplicates for seamless loop) */}
            <div className="ttprow-marquee mt-3 overflow-hidden px-4 pb-4">
              <ul className="flex w-max gap-3 facet-row-marquee hover:[animation-play-state:paused] motion-safe:animate-[facet-row-marquee_55s_linear_infinite]">
                {[...items, ...items].map((it, idx) => (
                  <li
                    key={`${it.id}:${idx}`}
                    aria-hidden={idx >= items.length ? true : undefined}
                    className="min-w-[220px] shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-900/80 bg-white/60 dark:bg-black/30 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.name}</div>
                        <div className="text-[11px] text-zinc-500 tabular-nums tracking-wide">{it.id}</div>
                      </div>
                      <div className="text-right text-[11px] text-zinc-500 shrink-0">
                        <div>
                          <span className="inline-flex items-center gap-1 text-zinc-600">
                            Score
                            <InfoTip
                              title="Score"
                              body="A decayed support score for this relationship. Each observation adds (source reliability × extraction confidence). Older observations decay with a 30‑day half‑life."
                            />
                          </span>{" "}
                          <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="inline-flex items-center gap-1 text-zinc-600">
                            Confidence
                            <InfoTip
                              title="Confidence"
                              body="How sure we are the relationship is real (0–100%). This is the highest confidence seen in evidence, not how often it appears."
                            />
                          </span>{" "}
                          <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                            {Math.round(it.confidence * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    <EvidenceDetails evidence={it.evidence} />
                  </li>
                ))}
              </ul>
            </div>

            {/* Open: show all items once (manual scroll) */}
            <div className="ttprow-full mt-3 px-4 pb-4">
              <ul className="flex gap-3 overflow-x-auto">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="min-w-[220px] shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-900/80 bg-white/60 dark:bg-black/30 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.name}</div>
                        <div className="text-[11px] text-zinc-500 tabular-nums tracking-wide">{it.id}</div>
                      </div>
                      <div className="text-right text-[11px] text-zinc-500 shrink-0">
                        <div>
                          <span className="inline-flex items-center gap-1 text-zinc-600">
                            Score
                            <InfoTip
                              title="Score"
                              body="A decayed support score for this relationship. Each observation adds (source reliability × extraction confidence). Older observations decay with a 30‑day half‑life."
                            />
                          </span>{" "}
                          <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="inline-flex items-center gap-1 text-zinc-600">
                            Confidence
                            <InfoTip
                              title="Confidence"
                              body="How sure we are the relationship is real (0–100%). This is the highest confidence seen in evidence, not how often it appears."
                            />
                          </span>{" "}
                          <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                            {Math.round(it.confidence * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    <EvidenceDetails evidence={it.evidence} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="px-4 py-4 text-sm text-zinc-500">No data yet.</p>
        )}
      </details>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
        <span className="text-xs text-zinc-500 tabular-nums">{formatShownOfTotal(items.length, totalCount)}</span>
      </div>

      {items.length ? (
        <ul className="mt-3 flex gap-3 overflow-x-auto px-4 pb-4">
          {items.map((it) => (
            <li
              key={it.id}
              className="min-w-[220px] shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-900/80 bg-white/60 dark:bg-black/30 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.name}</div>
                  <div className="text-[11px] text-zinc-500 tabular-nums tracking-wide">{it.id}</div>
                </div>
                <div className="text-right text-[11px] text-zinc-500 shrink-0">
                  <div>
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      Score
                      <InfoTip
                        title="Score"
                        body="A decayed support score for this relationship. Each observation adds (source reliability × extraction confidence). Older observations decay with a 30‑day half‑life."
                      />
                    </span>{" "}
                    <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      Confidence
                      <InfoTip
                        title="Confidence"
                        body="How sure we are the relationship is real (0–100%). This is the highest confidence seen in evidence, not how often it appears."
                      />
                    </span>{" "}
                    <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                      {Math.round(it.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              <EvidenceDetails evidence={it.evidence} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-zinc-500">No data yet.</p>
      )}
    </section>
  );
}

const ATTACK_TACTIC_ORDER = [
  "Reconnaissance",
  "Resource Development",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command & Control",
  "Exfiltration",
  "Impact",
] as const;
type AttackTactic = (typeof ATTACK_TACTIC_ORDER)[number];

function getTechniqueTacticsFromAttributes(attrs: unknown): AttackTactic[] {
  if (!attrs || typeof attrs !== "object") return [];
  const obj = attrs as any;

  const raw =
    obj["tactics"] ??
    obj["mitreAttack"]?.["tactics"] ??
    obj["attack"]?.["tactics"] ??
    obj["attackTactics"] ??
    null;

  if (!Array.isArray(raw)) return [];

  const set = new Set<AttackTactic>();
  for (const t of raw) {
    const v = typeof t === "string" ? t.trim() : "";
    if (!v) continue;
    if ((ATTACK_TACTIC_ORDER as readonly string[]).includes(v)) set.add(v as AttackTactic);
  }
  return Array.from(set);
}

function pickPrimaryTactic(tactics: AttackTactic[]): AttackTactic | null {
  for (const t of ATTACK_TACTIC_ORDER) if (tactics.includes(t)) return t;
  return tactics[0] ?? null;
}

function TechniqueCard({ it }: { it: { id: string; name: string; support: number; confidence: number; evidence: EvidenceItem[] } }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-900/80 bg-white/60 dark:bg-black/30 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.name}</div>
          <div className="text-[11px] text-zinc-500 tabular-nums tracking-wide">{it.id}</div>
        </div>
        <div className="text-right text-[11px] text-zinc-500 shrink-0">
          <div>
            <span className="inline-flex items-center gap-1 text-zinc-600">
              Score
              <InfoTip
                title="Score"
                body="A decayed support score for this relationship. Each observation adds (source reliability × extraction confidence). Older observations decay with a 30‑day half‑life."
              />
            </span>{" "}
            <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">{it.support.toFixed(2)}</span>
          </div>
          <div>
            <span className="inline-flex items-center gap-1 text-zinc-600">
              Confidence
              <InfoTip
                title="Confidence"
                body="How sure we are the relationship is real (0–100%). This is the highest confidence seen in evidence, not how often it appears."
              />
            </span>{" "}
            <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
              {Math.round(it.confidence * 100)}%
            </span>
          </div>
        </div>
      </div>

      <EvidenceDetails evidence={it.evidence} />
    </div>
  );
}

function FlowConnector() {
  return (
    <>
      {/* Desktop: left-to-right connector */}
      <div className="hidden md:flex items-center justify-center px-2" aria-hidden="true">
        <div className="h-px w-6 bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="-ml-1 text-zinc-400 dark:text-zinc-600">→</div>
      </div>

      {/* Mobile: top-to-bottom connector */}
      <div className="md:hidden flex items-center justify-center py-2" aria-hidden="true">
        <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-800/80" />
        <div className="mx-2 text-zinc-400 dark:text-zinc-600">↓</div>
        <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-800/80" />
      </div>
    </>
  );
}

function TopTtpSection({
  items,
  totalCount,
}: {
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    attributes?: unknown;
    support: number;
    confidence: number;
    evidence: EvidenceItem[];
  }>;
  totalCount?: number;
}) {
  const itemsWithTactics = items.map((it) => ({
    ...it,
    tactics: getTechniqueTacticsFromAttributes(it.attributes),
  }));

  const byTactic = new Map<AttackTactic, typeof itemsWithTactics>();
  const unmapped: typeof itemsWithTactics = [];
  for (const it of itemsWithTactics) {
    const primary = pickPrimaryTactic(it.tactics);
    if (!primary) {
      unmapped.push(it);
      continue;
    }
    const cur = byTactic.get(primary) ?? [];
    cur.push(it);
    byTactic.set(primary, cur);
  }

  const groups = ATTACK_TACTIC_ORDER
    .filter((t) => (byTactic.get(t)?.length ?? 0) > 0)
    .map((t) => ({ tactic: t, items: byTactic.get(t)! }));

  return (
    <details className="group rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none">
        <div className="flex items-baseline justify-between px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Top TTPs (ATT&amp;CK)</h1>
            <p className="mt-1 text-xs text-zinc-500 group-open:hidden">Hover to pause; expand to view all grouped by tactic.</p>
            <p className="mt-1 text-xs text-zinc-500 hidden group-open:block">
              Grouped by MITRE ATT&amp;CK Enterprise tactic order.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-zinc-500 tabular-nums">{formatShownOfTotal(items.length, totalCount)}</span>
            <span className="text-xs text-zinc-700 dark:text-zinc-300 group-open:hidden">Expand</span>
            <span className="text-xs text-zinc-700 dark:text-zinc-300 hidden group-open:inline">Collapse</span>
          </div>
        </div>
      </summary>

      {items.length ? (
        <div className="px-4 pb-4">
          {/* Collapsed view: existing marquee row */}
          <div className="group-open:hidden overflow-hidden">
            <style>{`
              @keyframes facet-row-marquee {
                from { transform: translateX(0); }
                to   { transform: translateX(-50%); }
              }
              @media (prefers-reduced-motion: reduce) {
                .facet-row-marquee { animation: none !important; transform: none !important; }
              }
            `}</style>
            <ul className="flex w-max gap-3 facet-row-marquee hover:[animation-play-state:paused] motion-safe:animate-[facet-row-marquee_55s_linear_infinite]">
              {[...items, ...items].map((it, idx) => (
                <li
                  key={`${it.id}:${idx}`}
                  aria-hidden={idx >= items.length ? true : undefined}
                  className="min-w-[220px] shrink-0"
                >
                  <TechniqueCard it={it} />
                </li>
              ))}
            </ul>
          </div>

          {/* Expanded view: grouped by tactic */}
          <div className="hidden group-open:block">
            {groups.length ? (
              <div className="mt-2 flex flex-col md:flex-row md:items-start md:overflow-x-auto md:pb-2">
                {groups.map((g, idx) => (
                  <div key={g.tactic} className="flex flex-col md:flex-row md:items-stretch">
                    <div className="md:min-w-[320px] md:max-w-[360px]">
                      <div className="flex items-baseline justify-between">
                        <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                          {g.tactic}
                        </div>
                        <div className="text-xs text-zinc-500 tabular-nums">{g.items.length}</div>
                      </div>
                      <div className="mt-2 space-y-3">
                        {g.items.map((it) => (
                          <TechniqueCard key={it.id} it={it} />
                        ))}
                      </div>
                    </div>

                    {idx < groups.length - 1 ? <FlowConnector /> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-zinc-500">
                  No tactic mapping available for these techniques yet.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Tactics are pulled from MITRE ATT&amp;CK technique metadata. If this actor&apos;s techniques were added from OSINT first, re-sync ATT&amp;CK data to populate tactics.
                </p>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((it) => (
                    <TechniqueCard key={it.id} it={it} />
                  ))}
                </div>
              </div>
            )}

            {unmapped.length && groups.length ? (
              <p className="mt-3 text-xs text-zinc-500">
                {unmapped.length} technique{unmapped.length === 1 ? "" : "s"} missing tactic mapping.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-zinc-500">No data yet.</p>
      )}
    </details>
  );
}

function MitigationBars({
  items,
}: {
  items: Array<{ id: string; name: string; count: number; evidence: EvidenceItem[] }>;
}) {
  const max = Math.max(1, ...items.map((m) => Math.max(0, m.count ?? 0)));
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-900/80 bg-white/70 dark:bg-black/35 px-3 py-2">
      <div className="lg:max-h-[420px] overflow-auto pr-1">
        <div className="space-y-2">
        {items.map((m) => {
          const w = `${Math.round((Math.max(0, m.count) / max) * 100)}%`;
          return (
            <details key={m.id} className="group">
              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {m.name}
                    </div>
                    <div className="text-xs text-zinc-500 tabular-nums tracking-wide">{m.id}</div>
                  </div>
                  <div className="shrink-0 text-xs text-zinc-500 tabular-nums">
                    {m.count}
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-200/70 dark:bg-zinc-800/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-zinc-700/60 dark:bg-zinc-200/40"
                    style={{ width: w }}
                  />
                </div>
              </summary>
              <div className="mt-2">
                <EvidenceDetails evidence={m.evidence} />
              </div>
            </details>
          );
        })}
        </div>
      </div>
    </div>
  );
}

