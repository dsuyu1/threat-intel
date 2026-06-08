import { findings, kgEntities, kgRelations, type getDb } from "@ti/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type DefendTechniqueTile = {
  id: string;
  name: string;
  bucket: number; // 0-5
  mentions90d: number;
  itw90d: number;
  actorCount: number;
  d3fendCount: number;
  subtechniques?: DefendTechniqueTile[];
};

export type DefendTacticColumn = {
  slug: string;
  label: string;
  items: DefendTechniqueTile[];
};

const ATTACK_TACTIC_ORDER = [
  "reconnaissance",
  "resource-development",
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
] as const;

const ATTACK_TACTIC_LABEL_BY_SLUG: Record<(typeof ATTACK_TACTIC_ORDER)[number], string> = {
  reconnaissance: "Reconnaissance",
  "resource-development": "Resource Development",
  "initial-access": "Initial Access",
  execution: "Execution",
  persistence: "Persistence",
  "privilege-escalation": "Privilege Escalation",
  "defense-evasion": "Defense Evasion",
  "credential-access": "Credential Access",
  discovery: "Discovery",
  "lateral-movement": "Lateral Movement",
  collection: "Collection",
  "command-and-control": "Command & Control",
  exfiltration: "Exfiltration",
  impact: "Impact",
};

const ATTACK_TACTIC_SLUG_BY_LABEL: Record<string, (typeof ATTACK_TACTIC_ORDER)[number]> = Object.fromEntries(
  Object.entries(ATTACK_TACTIC_LABEL_BY_SLUG).map(([slug, label]) => [label.toLowerCase(), slug as any])
) as any;

function coerceJson(value: unknown) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeTechniqueTactics(attributes: unknown): string[] {
  const obj = coerceJson(attributes) ?? attributes;
  const anyAttrs = obj as any;
  const raw = Array.isArray(anyAttrs?.tactics)
    ? anyAttrs.tactics
    : typeof anyAttrs?.tactics === "string"
      ? String(anyAttrs.tactics)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  const out: string[] = [];
  const allowed = new Set<string>(ATTACK_TACTIC_ORDER);
  const seen = new Set<string>();

  for (const t of raw) {
    const v = String(t ?? "").trim();
    if (!v) continue;
    const lower = v.toLowerCase();
    const slug = allowed.has(lower) ? lower : ATTACK_TACTIC_SLUG_BY_LABEL[lower];
    if (!slug || !allowed.has(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }

  return out;
}

const MITRE_TECHNIQUE_ID_RE = /^T\d{4}(?:\.\d{3})?$/i;

function parseMitreIdList(value: string | null) {
  const parts = String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (!MITRE_TECHNIQUE_ID_RE.test(p)) continue;
    const id = p.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? (JSON.parse(tagsJson) as string[]) : [];
  } catch {
    return [];
  }
}

function isItwFinding(pocLevel: string | null, tagsJson: string | null) {
  if (String(pocLevel ?? "").toLowerCase() === "itw") return true;
  const tags = parseTags(tagsJson).map((t) => t.toLowerCase());
  return tags.includes("kev") || tags.includes("actively-exploited");
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base]!;
  const b = sorted[Math.min(sorted.length - 1, base + 1)]!;
  return a + rest * (b - a);
}

function bucketizeCounts(counts: number[]) {
  const vals = counts.filter((x) => x > 0).map((x) => Math.log1p(x));
  vals.sort((a, b) => a - b);
  const t1 = quantile(vals, 0.2);
  const t2 = quantile(vals, 0.4);
  const t3 = quantile(vals, 0.6);
  const t4 = quantile(vals, 0.8);
  return (count: number) => {
    if (!count) return 0;
    const v = Math.log1p(count);
    if (v <= t1) return 1;
    if (v <= t2) return 2;
    if (v <= t3) return 3;
    if (v <= t4) return 4;
    return 5;
  };
}

export async function buildDefendHeatmapColumns({
  db,
  days,
}: {
  db: ReturnType<typeof getDb>;
  days: number;
}): Promise<DefendTacticColumn[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const t2m = alias(kgRelations, "t2m");
  const m2d3 = alias(kgRelations, "m2d3");

  const [techRows, actorRows, findingRows, d3Rows] = await Promise.all([
    db
      .select({
        id: kgEntities.entityId,
        name: kgEntities.name,
        attributes: kgEntities.attributes,
      })
      .from(kgEntities)
      .where(eq(kgEntities.kind, "technique"))
      .orderBy(asc(kgEntities.entityId))
      .limit(5000),

    db
      .select({
        techniqueId: kgRelations.toId,
        actorCount: sql<number>`count(*)`,
      })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "actor_uses_technique"),
          eq(kgRelations.fromKind, "actor"),
          eq(kgRelations.toKind, "technique")
        )
      )
      .groupBy(kgRelations.toId),

    db
      .select({
        mitreIds: findings.mitreIds,
        tags: findings.tags,
        pocLevel: findings.pocLevel,
        publishedAt: findings.publishedAt,
        createdAt: findings.createdAt,
      })
      .from(findings)
      .where(
        and(
          isNotNull(findings.mitreIds),
          sql<boolean>`COALESCE(${findings.publishedAt}, ${findings.createdAt}) >= ${cutoff}`
        )
      )
      .limit(20000),

    db
      .select({
        techniqueId: t2m.fromId,
        d3fendCount: sql<number>`count(distinct ${m2d3.toId})`,
      })
      .from(t2m)
      .innerJoin(
        m2d3,
        and(
          eq(m2d3.type, "mitigation_mapped_to_d3fend"),
          eq(m2d3.fromKind, "mitigation"),
          eq(m2d3.toKind, "d3fend_technique"),
          eq(m2d3.fromId, t2m.toId)
        )
      )
      .where(
        and(
          eq(t2m.type, "technique_mitigated_by"),
          eq(t2m.fromKind, "technique"),
          eq(t2m.toKind, "mitigation")
        )
      )
      .groupBy(t2m.fromId)
      .limit(20000),
  ]);

  const actorCountByTechnique = new Map<string, number>();
  for (const r of actorRows) {
    actorCountByTechnique.set(String(r.techniqueId).toUpperCase(), Number(r.actorCount ?? 0));
  }

  const d3fendCountByTechnique = new Map<string, number>();
  for (const r of d3Rows) {
    d3fendCountByTechnique.set(String(r.techniqueId).toUpperCase(), Number(r.d3fendCount ?? 0));
  }

  const mentionsByTechnique = new Map<string, number>();
  const itwByTechnique = new Map<string, number>();

  for (const f of findingRows) {
    const ids = parseMitreIdList(f.mitreIds);
    if (!ids.length) continue;
    const itw = isItwFinding(f.pocLevel ? String(f.pocLevel) : null, f.tags);
    for (const id of ids) {
      mentionsByTechnique.set(id, (mentionsByTechnique.get(id) ?? 0) + 1);
      if (itw) itwByTechnique.set(id, (itwByTechnique.get(id) ?? 0) + 1);
    }
  }

  const bucketForTechnique = bucketizeCounts(Array.from(mentionsByTechnique.values()));

  const columns: DefendTacticColumn[] = ATTACK_TACTIC_ORDER.map((slug) => ({
    slug,
    label: ATTACK_TACTIC_LABEL_BY_SLUG[slug],
    items: [],
  }));
  const colBySlug = new Map(columns.map((c) => [c.slug, c] as const));

  type BaseTile = Omit<DefendTechniqueTile, "bucket" | "subtechniques">;
  type Group = { parentId: string; parent?: BaseTile; subs: BaseTile[] };
  const groupsByTactic = new Map<string, Map<string, Group>>();

  for (const t of techRows) {
    const tid = String(t.id).toUpperCase();
    const tactics = normalizeTechniqueTactics(t.attributes);
    if (!tactics.length) continue;
    const mentions90d = mentionsByTechnique.get(tid) ?? 0;
    const itw90d = itwByTechnique.get(tid) ?? 0;
    const actorCount = actorCountByTechnique.get(tid) ?? 0;
    const d3fendCount = d3fendCountByTechnique.get(tid) ?? 0;
    const base: BaseTile = {
      id: tid,
      name: String(t.name),
      mentions90d,
      itw90d,
      actorCount,
      d3fendCount,
    };

    const parentId = tid.includes(".") ? tid.split(".")[0]! : tid;
    const isSub = tid !== parentId;

    for (const slug of tactics) {
      let map = groupsByTactic.get(slug);
      if (!map) {
        map = new Map<string, Group>();
        groupsByTactic.set(slug, map);
      }
      let group = map.get(parentId);
      if (!group) {
        group = { parentId, subs: [] };
        map.set(parentId, group);
      }
      if (isSub) group.subs.push(base);
      else group.parent = base;
    }
  }

  const aggregatedCounts: number[] = [];
  const aggMetaByTactic = new Map<string, Array<{ group: Group; mentions: number; itw: number; actors: number; d3: number; name: string }>>();

  for (const slug of ATTACK_TACTIC_ORDER) {
    const map = groupsByTactic.get(slug) ?? null;
    if (!map) continue;
    const rows: Array<{ group: Group; mentions: number; itw: number; actors: number; d3: number; name: string }> = [];
    for (const group of map.values()) {
      const members: BaseTile[] = [];
      if (group.parent) members.push(group.parent);
      members.push(...group.subs);

      const mentions = members.reduce((acc, x) => acc + (x.mentions90d ?? 0), 0);
      const itw = members.reduce((acc, x) => acc + (x.itw90d ?? 0), 0);
      const actors = members.reduce((acc, x) => acc + (x.actorCount ?? 0), 0);
      const d3 = members.reduce((acc, x) => acc + (x.d3fendCount ?? 0), 0);
      const name = group.parent?.name ?? group.subs[0]?.name ?? group.parentId;
      aggregatedCounts.push(mentions);
      rows.push({ group, mentions, itw, actors, d3, name });
    }
    aggMetaByTactic.set(slug, rows);
  }

  const bucketForGroup = bucketizeCounts(aggregatedCounts);

  for (const slug of ATTACK_TACTIC_ORDER) {
    const col = colBySlug.get(slug);
    if (!col) continue;
    const rows = aggMetaByTactic.get(slug) ?? [];
    for (const r of rows) {
      const subs = r.group.subs
        .slice()
        .sort((a, b) => {
          const ba = bucketForTechnique(a.mentions90d);
          const bb = bucketForTechnique(b.mentions90d);
          if (bb !== ba) return bb - ba;
          if (b.mentions90d !== a.mentions90d) return b.mentions90d - a.mentions90d;
          return a.id.localeCompare(b.id);
        })
        .map((s) => ({
          id: s.id,
          name: s.name,
          bucket: bucketForTechnique(s.mentions90d),
          mentions90d: s.mentions90d,
          itw90d: s.itw90d,
          actorCount: s.actorCount,
          d3fendCount: s.d3fendCount,
        }));

      col.items.push({
        id: r.group.parentId,
        name: r.name,
        bucket: bucketForGroup(r.mentions),
        mentions90d: r.mentions,
        itw90d: r.itw,
        actorCount: r.actors,
        d3fendCount: r.d3,
        subtechniques: subs.length ? subs : undefined,
      });
    }
  }

  for (const c of columns) {
    c.items.sort((a, b) => {
      if (b.bucket !== a.bucket) return b.bucket - a.bucket;
      if (b.mentions90d !== a.mentions90d) return b.mentions90d - a.mentions90d;
      if (b.itw90d !== a.itw90d) return b.itw90d - a.itw90d;
      if (b.actorCount !== a.actorCount) return b.actorCount - a.actorCount;
      return a.name.localeCompare(b.name);
    });
  }

  return columns;
}
