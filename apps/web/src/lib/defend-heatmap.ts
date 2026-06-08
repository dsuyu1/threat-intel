import { findings, kgEntities, kgRelations, type getDb } from "@ti/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

export type DefendTechniqueTile = {
  id: string;
  name: string;
  bucket: number; // 0-5
  mentions90d: number;
  itw90d: number;
  actorCount: number;
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

function normalizeTechniqueTactics(attributes: unknown): string[] {
  const anyAttrs = attributes as any;
  const raw = Array.isArray(anyAttrs?.tactics) ? anyAttrs.tactics : [];
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

  const [techRows, actorRows, findingRows] = await Promise.all([
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
  ]);

  const actorCountByTechnique = new Map<string, number>();
  for (const r of actorRows) actorCountByTechnique.set(String(r.techniqueId), Number(r.actorCount ?? 0));

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

  const bucketFor = bucketizeCounts(Array.from(mentionsByTechnique.values()));

  const columns: DefendTacticColumn[] = ATTACK_TACTIC_ORDER.map((slug) => ({
    slug,
    label: ATTACK_TACTIC_LABEL_BY_SLUG[slug],
    items: [],
  }));
  const colBySlug = new Map(columns.map((c) => [c.slug, c] as const));

  for (const t of techRows) {
    const tid = String(t.id);
    const tactics = normalizeTechniqueTactics(t.attributes);
    if (!tactics.length) continue;
    const mentions90d = mentionsByTechnique.get(tid) ?? 0;
    const itw90d = itwByTechnique.get(tid) ?? 0;
    const actorCount = actorCountByTechnique.get(tid) ?? 0;
    const tile: DefendTechniqueTile = {
      id: tid,
      name: String(t.name),
      bucket: bucketFor(mentions90d),
      mentions90d,
      itw90d,
      actorCount,
    };

    for (const slug of tactics) {
      colBySlug.get(slug as any)?.items.push(tile);
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

