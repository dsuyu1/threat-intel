import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { alias } from "drizzle-orm/pg-core";
import type * as schema from "../schema";
import {
  actorNeighbors,
  kgEntities,
  kgEvidence,
  kgRelations,
  navigatorActionStatusEnum,
  navigatorConfigs,
  navigatorRiskAppetiteEnum,
  navigatorScenarioTypeEnum,
  navigatorScenarios,
  projects,
  teams,
  userPreferences,
  userStack,
  users,
} from "../schema";
import {
  assignPercentileScores,
  classifyKevStackMatch,
  clamp01,
  recencyScore,
  relationStrength,
  stackMatchScore,
  topFactors,
  type WeightedFactor,
} from "./scoring";

export type Db = NeonHttpDatabase<typeof schema>;

export type NavigatorRiskAppetite =
  (typeof navigatorRiskAppetiteEnum.enumValues)[number];
export type NavigatorScenarioType =
  (typeof navigatorScenarioTypeEnum.enumValues)[number];
export type NavigatorActionStatus =
  (typeof navigatorActionStatusEnum.enumValues)[number];

export type CrownJewelId =
  | "customer_data"
  | "identity"
  | "payments"
  | "prod_apps"
  | "source_code"
  | "ot_it"
  | "email"
  | "endpoints";

export type CrownJewel = { id: CrownJewelId; weight: number };

export type NavigatorConfigInput = {
  sector: string;
  riskAppetite: NavigatorRiskAppetite;
  crownJewels: CrownJewel[];
};

export type UserStackInputItem = {
  technology: string;
  versionRange?: string | null;
};

type EvidenceItem = {
  excerpt: string;
  url: string;
  publishedAt: string | null;
  confidence: number;
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

type AttackTactic = (typeof ATTACK_TACTIC_ORDER)[number];

function getTechniqueTacticsFromAttributes(attrs: unknown): AttackTactic[] {
  const arr = (attrs as any)?.tactics;
  if (!Array.isArray(arr)) return [];
  const set = new Set<AttackTactic>();
  for (const v of arr) {
    if ((ATTACK_TACTIC_ORDER as readonly string[]).includes(String(v))) {
      set.add(String(v) as AttackTactic);
    }
  }
  return Array.from(set);
}

function pickPrimaryTactic(tactics: AttackTactic[]): AttackTactic | null {
  for (const t of ATTACK_TACTIC_ORDER) if (tactics.includes(t)) return t;
  return tactics[0] ?? null;
}

function firstSentence(text: string) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.{20,240}?)(?:\. |\.$|; |$)/);
  return (m?.[1] ?? t).trim();
}

function scenarioKeyFor(params: {
  projectId: string;
  scenarioType: NavigatorScenarioType;
  actorId: string;
  targetKind: string;
  targetId: string;
  inferredFromActorId?: string;
}) {
  const inferredFrom = params.inferredFromActorId ?? "";
  return [
    `p:${params.projectId}`,
    `t:${params.scenarioType}`,
    `a:${params.actorId}`,
    `k:${params.targetKind}`,
    `id:${params.targetId}`,
    `inf:${inferredFrom}`,
  ].join("|");
}

async function getCandidateActors(params: {
  db: Db;
  sector: string;
  limit: number;
}) {
  const { db } = params;
  const sector = String(params.sector ?? "all").trim() || "all";

  if (sector !== "all") {
    const rows = await db
      .select({
        actorId: kgRelations.fromId,
        strength: sql<number>`max(${kgRelations.support} * ${kgRelations.confidence})`,
        lastSeen: sql<Date>`max(${kgRelations.lastSeen})`,
      })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "actor_targets_sector"),
          eq(kgRelations.fromKind, "actor"),
          eq(kgRelations.toKind, "sector"),
          eq(kgRelations.toId, sector)
        )
      )
      .groupBy(kgRelations.fromId)
      .orderBy(desc(sql`max(${kgRelations.support} * ${kgRelations.confidence})`), desc(sql`max(${kgRelations.lastSeen})`), asc(kgRelations.fromId))
      .limit(params.limit);

    if (rows.length) return rows;
  }

  // Fallback: most recently observed activity for any actor.
  return db
    .select({
      actorId: kgRelations.fromId,
      strength: sql<number>`0`,
      lastSeen: sql<Date>`max(${kgRelations.lastSeen})`,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.fromKind, "actor"),
        inArray(kgRelations.type, ["actor_uses_technique", "actor_exploits_cve"])
      )
    )
    .groupBy(kgRelations.fromId)
    .orderBy(desc(sql`max(${kgRelations.lastSeen})`), asc(kgRelations.fromId))
    .limit(params.limit);
}

export async function getNavigatorConfigForProject(params: {
  db: Db;
  projectId: string;
}) {
  const [row] = await params.db
    .select({
      sector: navigatorConfigs.sector,
      riskAppetite: navigatorConfigs.riskAppetite,
      crownJewels: navigatorConfigs.crownJewels,
    })
    .from(navigatorConfigs)
    .where(eq(navigatorConfigs.projectId, params.projectId))
    .limit(1);

  const sector = String(row?.sector ?? "all");
  const riskAppetite = (row?.riskAppetite ??
    "balanced") as NavigatorRiskAppetite;
  const crownJewelsRaw = row?.crownJewels as unknown;
  const crownJewels = Array.isArray(crownJewelsRaw) ? (crownJewelsRaw as CrownJewel[]) : [];

  return { sector, riskAppetite, crownJewels };
}

export async function upsertNavigatorConfig(params: {
  db: Db;
  projectId: string;
  userId: string;
  config: NavigatorConfigInput;
}) {
  const now = new Date();
  await params.db
    .insert(navigatorConfigs)
    .values({
      projectId: params.projectId,
      userId: params.userId,
      sector: params.config.sector,
      riskAppetite: params.config.riskAppetite,
      crownJewels: params.config.crownJewels as never,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [navigatorConfigs.projectId],
      set: {
        userId: params.userId,
        sector: sql`excluded.sector`,
        riskAppetite: sql`excluded.risk_appetite`,
        crownJewels: sql`excluded.crown_jewels`,
        updatedAt: now,
      },
    });
}

export async function replaceUserStack(params: {
  db: Db;
  projectId: string;
  userId: string;
  items: UserStackInputItem[];
}) {
  const items = (params.items ?? [])
    .map((it) => ({
      technology: String(it.technology ?? "").trim(),
      versionRange: it.versionRange ? String(it.versionRange).trim() : null,
    }))
    .filter((it) => it.technology);

  const deduped: typeof items = [];
  const seen = new Set<string>();
  for (const it of items) {
    const key = it.technology.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  await params.db.delete(userStack).where(eq(userStack.projectId, params.projectId));
  if (!deduped.length) return;

  await params.db.insert(userStack).values(
    deduped.map((it) => ({
      projectId: params.projectId,
      userId: params.userId,
      technology: it.technology,
      versionRange: it.versionRange ?? undefined,
      sector: "all",
    }))
  );
}

export async function recomputeNavigatorScenariosForUser(params: {
  db: Db;
  projectId: string;
  userId: string;
  includeInferred?: boolean;
}) {
  const db = params.db;
  const now = new Date();

  const config = await getNavigatorConfigForProject({ db, projectId: params.projectId });
  const stackRows = await db
    .select({ technology: userStack.technology })
    .from(userStack)
    .where(eq(userStack.projectId, params.projectId));
  const userStackTech = stackRows.map((r) => r.technology);

  const candidates = await getCandidateActors({
    db,
    sector: config.sector,
    limit: 40,
  });
  const actorIds = candidates.map((c) => c.actorId);
  const sectorStrengthByActor = new Map<string, number>();
  for (const c of candidates) sectorStrengthByActor.set(c.actorId, Number(c.strength ?? 0));

  if (!actorIds.length) {
    await db
      .delete(navigatorScenarios)
      .where(and(eq(navigatorScenarios.projectId, params.projectId), sql`${navigatorScenarios.scenarioType} <> 'ioc'`));
    return { total: 0 };
  }

  const actorEnt = alias(kgEntities, "actor_ent");
  const cveEnt = alias(kgEntities, "cve_ent");
  const techEnt = alias(kgEntities, "tech_ent");

  const cveRows = await db
    .select({
      relationId: kgRelations.id,
      actorId: kgRelations.fromId,
      actorName: actorEnt.name,
      cveId: kgRelations.toId,
      cveName: cveEnt.name,
      cveDescription: cveEnt.description,
      cveAttributes: cveEnt.attributes,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .innerJoin(
      actorEnt,
      and(eq(actorEnt.kind, "actor"), eq(actorEnt.entityId, kgRelations.fromId))
    )
    .innerJoin(
      cveEnt,
      and(eq(cveEnt.kind, "cve"), eq(cveEnt.entityId, kgRelations.toId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_exploits_cve"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "cve"),
        inArray(kgRelations.fromId, actorIds)
      )
    )
    .orderBy(
      desc(sql`${kgRelations.support} * ${kgRelations.confidence}`),
      desc(kgRelations.lastSeen),
      asc(kgRelations.fromId),
      asc(kgRelations.toId)
    )
    .limit(140);

  const techRows = await db
    .select({
      relationId: kgRelations.id,
      actorId: kgRelations.fromId,
      actorName: actorEnt.name,
      techniqueId: kgRelations.toId,
      techniqueName: techEnt.name,
      techniqueAttributes: techEnt.attributes,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
      hasEvidence: sql<number>`case when exists (select 1 from ${kgEvidence} where ${kgEvidence.relationId} = ${kgRelations.id}) then 1 else 0 end`,
    })
    .from(kgRelations)
    .innerJoin(
      actorEnt,
      and(eq(actorEnt.kind, "actor"), eq(actorEnt.entityId, kgRelations.fromId))
    )
    .innerJoin(
      techEnt,
      and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_uses_technique"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "technique"),
        inArray(kgRelations.fromId, actorIds)
      )
    )
    .orderBy(
      desc(sql`case when exists (select 1 from ${kgEvidence} where ${kgEvidence.relationId} = ${kgRelations.id}) then 1 else 0 end`),
      desc(sql`${kgRelations.support} * ${kgRelations.confidence}`),
      desc(kgRelations.lastSeen),
      asc(kgRelations.fromId),
      asc(kgRelations.toId)
    )
    .limit(220);

  const relationIds: string[] = [];
  for (const r of cveRows) relationIds.push(r.relationId);
  for (const r of techRows) relationIds.push(r.relationId);

  const evidenceByRelation = new Map<string, EvidenceItem[]>();
  if (relationIds.length) {
    const evRows = await db
      .select({
        relationId: kgEvidence.relationId,
        excerpt: kgEvidence.excerpt,
        url: kgEvidence.url,
        publishedAt: kgEvidence.publishedAt,
        confidence: kgEvidence.confidence,
      })
      .from(kgEvidence)
      .where(inArray(kgEvidence.relationId, relationIds))
      .orderBy(desc(kgEvidence.confidence), desc(kgEvidence.publishedAt));

    for (const e of evRows) {
      const existing = evidenceByRelation.get(e.relationId) ?? [];
      if (existing.length >= 3) continue;
      existing.push({
        excerpt: e.excerpt,
        url: e.url,
        publishedAt: e.publishedAt ? new Date(e.publishedAt).toISOString() : null,
        confidence: Number(e.confidence ?? 0),
      });
      evidenceByRelation.set(e.relationId, existing);
    }
  }

  const directTechByActor = new Map<string, Set<string>>();
  for (const r of techRows) {
    const set = directTechByActor.get(r.actorId) ?? new Set<string>();
    set.add(r.techniqueId);
    directTechByActor.set(r.actorId, set);
  }

  type Generated = {
    scenarioKey: string;
    scenarioType: NavigatorScenarioType;
    actorId: string;
    actorName: string | null;
    targetKind: string;
    targetId: string;
    targetName: string | null;
    inferredFromActorId: string;
    title: string;
    summary: string | null;
    rawPriority: number;
    score: number;
    primaryTactic: string | null;
    tactics: string[] | null;
    whyJson: unknown;
    evidenceJson: unknown;
    attributes: unknown;
  };

  const scenarios: Generated[] = [];

  for (const r of cveRows) {
    const relStrength = relationStrength({ support: r.support, confidence: r.confidence });
    const rec = recencyScore({ lastSeen: r.lastSeen, now });
    const sectorStrength =
      config.sector === "all"
        ? 0.5
        : clamp01(Math.tanh(Number(sectorStrengthByActor.get(r.actorId) ?? 0)));
    const actorRel = clamp01(0.6 * sectorStrength + 0.4 * rec.score);

    const kev = (r.cveAttributes as any)?.kev ?? null;
    const stackMatch = classifyKevStackMatch({
      userStack: userStackTech,
      kevVendorProject: kev?.vendorProject ?? null,
      kevProduct: kev?.product ?? null,
    });
    const stackScore = stackMatchScore(stackMatch.kind);

    const factors: WeightedFactor[] = [
      {
        key: "actor_relevance",
        value: actorRel,
        weight: 0.3,
        contribution: actorRel * 0.3,
        details: { sector: config.sector, sectorStrength, recencyDays: rec.days, recencyScore: rec.score },
      },
      {
        key: "relation_strength",
        value: relStrength,
        weight: 0.5,
        contribution: relStrength * 0.5,
        details: { support: Number(r.support), confidence: Number(r.confidence), lastSeen: new Date(r.lastSeen).toISOString() },
      },
      {
        key: "stack_match",
        value: stackScore,
        weight: 0.2,
        contribution: stackScore * 0.2,
        details: {
          kind: stackMatch.kind,
          matchedTechnology: stackMatch.matchedTechnology,
          matchedOn: stackMatch.matchedOn,
          vendorProject: kev?.vendorProject ?? null,
          product: kev?.product ?? null,
        },
      },
    ];

    const rawPriority = clamp01(factors.reduce((acc, f) => acc + f.contribution, 0));
    const top = topFactors(factors, 3);

    const evidence = evidenceByRelation.get(r.relationId) ?? [];

    const scenarioType: NavigatorScenarioType = "cve";
    const scenarioKey = scenarioKeyFor({
      projectId: params.projectId,
      scenarioType,
      actorId: r.actorId,
      targetKind: "cve",
      targetId: r.cveId,
    });

    scenarios.push({
      scenarioKey,
      scenarioType,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      targetKind: "cve",
      targetId: r.cveId,
      targetName: r.cveName ?? null,
      inferredFromActorId: "",
      title: `${r.actorName} \u2014 Exploits ${r.cveId}`,
      summary: firstSentence(r.cveDescription ?? "") || null,
      rawPriority,
      score: 0,
      primaryTactic: null,
      tactics: null,
      whyJson: { factors, topFactors: top } as never,
      evidenceJson: { relationId: r.relationId, items: evidence } as never,
      attributes: {
        cveId: r.cveId,
        kev: kev ?? null,
        stackMatch,
      } as never,
    });
  }

  for (const r of techRows) {
    const relStrength = relationStrength({ support: r.support, confidence: r.confidence });
    const rec = recencyScore({ lastSeen: r.lastSeen, now });
    const sectorStrength =
      config.sector === "all"
        ? 0.5
        : clamp01(Math.tanh(Number(sectorStrengthByActor.get(r.actorId) ?? 0)));
    const actorRel = clamp01(0.6 * sectorStrength + 0.4 * rec.score);

    const tactics = getTechniqueTacticsFromAttributes(r.techniqueAttributes);
    const primary = pickPrimaryTactic(tactics);

    const factors: WeightedFactor[] = [
      {
        key: "actor_relevance",
        value: actorRel,
        weight: 0.45,
        contribution: actorRel * 0.45,
        details: { sector: config.sector, sectorStrength, recencyDays: rec.days, recencyScore: rec.score },
      },
      {
        key: "relation_strength",
        value: relStrength,
        weight: 0.55,
        contribution: relStrength * 0.55,
        details: {
          support: Number(r.support),
          confidence: Number(r.confidence),
          lastSeen: new Date(r.lastSeen).toISOString(),
          hasEvidence: !!Number(r.hasEvidence ?? 0),
        },
      },
    ];

    const rawPriority = clamp01(factors.reduce((acc, f) => acc + f.contribution, 0));
    const top = topFactors(factors, 3);
    const evidence = evidenceByRelation.get(r.relationId) ?? [];

    const scenarioType: NavigatorScenarioType = "technique";
    const scenarioKey = scenarioKeyFor({
      projectId: params.projectId,
      scenarioType,
      actorId: r.actorId,
      targetKind: "technique",
      targetId: r.techniqueId,
    });

    scenarios.push({
      scenarioKey,
      scenarioType,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      targetKind: "technique",
      targetId: r.techniqueId,
      targetName: r.techniqueName ?? null,
      inferredFromActorId: "",
      title: `${r.actorName} \u2014 Uses ${r.techniqueId}`,
      summary: null,
      rawPriority,
      score: 0,
      primaryTactic: primary,
      tactics,
      whyJson: { factors, topFactors: top } as never,
      evidenceJson: { relationId: r.relationId, items: evidence } as never,
      attributes: {
        techniqueId: r.techniqueId,
        hasEvidence: !!Number(r.hasEvidence ?? 0),
      } as never,
    });
  }

  if (params.includeInferred ?? true) {
    const neighborRows = await db
      .select({
        actorId: actorNeighbors.actorId,
        neighborActorId: actorNeighbors.neighborActorId,
        distance: actorNeighbors.distance,
      })
      .from(actorNeighbors)
      .where(inArray(actorNeighbors.actorId, actorIds))
      .orderBy(asc(actorNeighbors.actorId), asc(actorNeighbors.distance))
      .limit(240);

    const neighborsByActor = new Map<string, Array<{ id: string; distance: number }>>();
    for (const r of neighborRows) {
      const list = neighborsByActor.get(r.actorId) ?? [];
      if (list.length >= 3) continue;
      list.push({ id: r.neighborActorId, distance: Number(r.distance ?? 0) });
      neighborsByActor.set(r.actorId, list);
    }

    const neighborIds = Array.from(new Set(neighborRows.map((r) => r.neighborActorId)));
    if (neighborIds.length) {
      const neighborEnt = alias(kgEntities, "neighbor_ent");

      const neighborTechRows = await db
        .select({
          relationId: kgRelations.id,
          neighborActorId: kgRelations.fromId,
          neighborActorName: neighborEnt.name,
          techniqueId: kgRelations.toId,
          techniqueName: techEnt.name,
          techniqueAttributes: techEnt.attributes,
          support: kgRelations.support,
          confidence: kgRelations.confidence,
          lastSeen: kgRelations.lastSeen,
          hasEvidence: sql<number>`case when exists (select 1 from ${kgEvidence} where ${kgEvidence.relationId} = ${kgRelations.id}) then 1 else 0 end`,
        })
        .from(kgRelations)
        .innerJoin(
          neighborEnt,
          and(eq(neighborEnt.kind, "actor"), eq(neighborEnt.entityId, kgRelations.fromId))
        )
        .innerJoin(
          techEnt,
          and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId))
        )
        .where(
          and(
            eq(kgRelations.type, "actor_uses_technique"),
            eq(kgRelations.fromKind, "actor"),
            eq(kgRelations.toKind, "technique"),
            inArray(kgRelations.fromId, neighborIds)
          )
        )
        .orderBy(
          desc(sql`case when exists (select 1 from ${kgEvidence} where ${kgEvidence.relationId} = ${kgRelations.id}) then 1 else 0 end`),
          desc(sql`${kgRelations.support} * ${kgRelations.confidence}`),
          desc(kgRelations.lastSeen)
        )
        .limit(900);

      // Pull evidence for inferred relations too.
      const inferredRelIds = neighborTechRows.map((r) => r.relationId);
      if (inferredRelIds.length) {
        const evRows = await db
          .select({
            relationId: kgEvidence.relationId,
            excerpt: kgEvidence.excerpt,
            url: kgEvidence.url,
            publishedAt: kgEvidence.publishedAt,
            confidence: kgEvidence.confidence,
          })
          .from(kgEvidence)
          .where(inArray(kgEvidence.relationId, inferredRelIds))
          .orderBy(desc(kgEvidence.confidence), desc(kgEvidence.publishedAt));

        for (const e of evRows) {
          const existing = evidenceByRelation.get(e.relationId) ?? [];
          if (existing.length >= 3) continue;
          existing.push({
            excerpt: e.excerpt,
            url: e.url,
            publishedAt: e.publishedAt ? new Date(e.publishedAt).toISOString() : null,
            confidence: Number(e.confidence ?? 0),
          });
          evidenceByRelation.set(e.relationId, existing);
        }
      }

      const neighborTechByActor = new Map<string, typeof neighborTechRows>();
      for (const r of neighborTechRows) {
        const list = neighborTechByActor.get(r.neighborActorId) ?? [];
        if (list.length >= 30) continue;
        list.push(r);
        neighborTechByActor.set(r.neighborActorId, list);
      }

      for (const actorId of actorIds) {
        const direct = directTechByActor.get(actorId) ?? new Set<string>();
        const neighbors = neighborsByActor.get(actorId) ?? [];
        const picked = new Set<string>();

        for (const n of neighbors) {
          const rels = neighborTechByActor.get(n.id) ?? [];
          for (const rel of rels) {
            if (direct.has(rel.techniqueId)) continue;
            const key = `${n.id}:${rel.techniqueId}`;
            if (picked.has(key)) continue;
            picked.add(key);
            if (picked.size >= 10) break;

            const similarity = clamp01(1 / (1 + Math.max(0, n.distance)));
            const base = relationStrength({ support: rel.support, confidence: rel.confidence });
            const inferredStrength = clamp01(base * similarity);

            const rec = recencyScore({ lastSeen: rel.lastSeen, now });
            const sectorStrength =
              config.sector === "all"
                ? 0.5
                : clamp01(Math.tanh(Number(sectorStrengthByActor.get(actorId) ?? 0)));
            const actorRel = clamp01(0.6 * sectorStrength + 0.4 * rec.score);

            const tactics = getTechniqueTacticsFromAttributes(rel.techniqueAttributes);
            const primary = pickPrimaryTactic(tactics);

            const factors: WeightedFactor[] = [
              {
                key: "actor_relevance",
                value: actorRel,
                weight: 0.45,
                contribution: actorRel * 0.45,
                details: { sector: config.sector, sectorStrength, recencyDays: rec.days, recencyScore: rec.score },
              },
              {
                key: "relation_strength",
                value: inferredStrength,
                weight: 0.55,
                contribution: inferredStrength * 0.55,
                details: {
                  inferredFromActorId: n.id,
                  neighborDistance: n.distance,
                  similarity,
                  baseRelationStrength: base,
                  hasEvidence: !!Number(rel.hasEvidence ?? 0),
                },
              },
            ];

            const rawPriority = clamp01(factors.reduce((acc, f) => acc + f.contribution, 0));
            const top = topFactors(factors, 3);
            const evidence = evidenceByRelation.get(rel.relationId) ?? [];

            const scenarioType: NavigatorScenarioType = "inferred";
            const scenarioKey = scenarioKeyFor({
              projectId: params.projectId,
              scenarioType,
              actorId,
              targetKind: "technique",
              targetId: rel.techniqueId,
              inferredFromActorId: n.id,
            });

            const actorName = scenarios.find((s) => s.actorId === actorId)?.actorName ?? null;

            scenarios.push({
              scenarioKey,
              scenarioType,
              actorId,
              actorName,
              targetKind: "technique",
              targetId: rel.techniqueId,
              targetName: rel.techniqueName ?? null,
              inferredFromActorId: n.id,
              title: `${actorName ?? actorId} \u2014 Inferred ${rel.techniqueId} (via ${rel.neighborActorName ?? n.id})`,
              summary: null,
              rawPriority,
              score: 0,
              primaryTactic: primary,
              tactics,
              whyJson: { factors, topFactors: top } as never,
              evidenceJson: { relationId: rel.relationId, items: evidence, inferredFromActorId: n.id } as never,
              attributes: {
                techniqueId: rel.techniqueId,
                inferredFromActorId: n.id,
                inferredFromActorName: rel.neighborActorName ?? null,
                neighborDistance: n.distance,
              } as never,
            });
          }
        }
      }
    }
  }

  // Assign percentile scores across all scenarios for this project.
  const pct = assignPercentileScores(scenarios);
  for (const s of scenarios) s.score = pct.get(s.scenarioKey) ?? 0;

  const keys = scenarios.map((s) => s.scenarioKey);

  if (keys.length === 0) {
    await db
      .delete(navigatorScenarios)
      .where(and(eq(navigatorScenarios.projectId, params.projectId), sql`${navigatorScenarios.scenarioType} <> 'ioc'`));
    return { total: 0 };
  }

  await db
    .insert(navigatorScenarios)
    .values(
      scenarios.map((s) => ({
        projectId: params.projectId,
        userId: params.userId,
        scenarioKey: s.scenarioKey,
        scenarioType: s.scenarioType,
        actorId: s.actorId,
        actorName: s.actorName ?? undefined,
        targetKind: s.targetKind,
        targetId: s.targetId,
        targetName: s.targetName ?? undefined,
        inferredFromActorId: s.inferredFromActorId,
        title: s.title,
        summary: s.summary ?? undefined,
        rawPriority: s.rawPriority,
        score: s.score,
        primaryTactic: s.primaryTactic ?? undefined,
        tactics: s.tactics ?? undefined,
        evidenceJson: s.evidenceJson as never,
        whyJson: s.whyJson as never,
        attributes: s.attributes as never,
        computedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [navigatorScenarios.projectId, navigatorScenarios.scenarioKey],
      set: {
        userId: sql`excluded.user_id`,
        scenarioType: sql`excluded.scenario_type`,
        actorId: sql`excluded.actor_id`,
        actorName: sql`excluded.actor_name`,
        targetKind: sql`excluded.target_kind`,
        targetId: sql`excluded.target_id`,
        targetName: sql`excluded.target_name`,
        inferredFromActorId: sql`excluded.inferred_from_actor_id`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        rawPriority: sql`excluded.raw_priority`,
        score: sql`excluded.score`,
        primaryTactic: sql`excluded.primary_tactic`,
        tactics: sql`excluded.tactics`,
        evidenceJson: sql`excluded.evidence_json`,
        whyJson: sql`excluded.why_json`,
        attributes: sql`excluded.attributes`,
        computedAt: now,
      },
    });

  // Remove any scenarios that are no longer in the generated set.
  await db
    .delete(navigatorScenarios)
    .where(
      and(
        eq(navigatorScenarios.projectId, params.projectId),
        sql`${navigatorScenarios.scenarioType} <> 'ioc'`,
        sql`${navigatorScenarios.scenarioKey} not in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`,`
        )})`
      )
    );

  return { total: scenarios.length };
}

async function ensurePersonalDefaultProjectId(params: { db: Db; userId: string }) {
  const db = params.db;
  const clerkOrgId = `personal:${params.userId}`;

  let teamId: string | null = null;
  const [existingTeam] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.clerkOrgId, clerkOrgId))
    .limit(1);
  teamId = existingTeam?.id ?? null;

  if (!teamId) {
    await db.insert(teams).values({ clerkOrgId, name: "Personal" }).onConflictDoNothing();
    const [createdTeam] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.clerkOrgId, clerkOrgId))
      .limit(1);
    teamId = createdTeam?.id ?? null;
  }

  if (!teamId) return null;

  let projectId: string | null = null;
  const [existingProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.teamId, teamId), eq(projects.slug, "default")))
    .limit(1);
  projectId = existingProject?.id ?? null;

  if (!projectId) {
    await db
      .insert(projects)
      .values({ teamId, slug: "default", name: "Default" })
      .onConflictDoNothing();
    const [createdProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.teamId, teamId), eq(projects.slug, "default")))
      .limit(1);
    projectId = createdProject?.id ?? null;
  }

  if (!projectId) return null;

  await db
    .insert(userPreferences)
    .values({ userId: params.userId, defaultProjectId: projectId })
    .onConflictDoUpdate({
      target: [userPreferences.userId],
      set: { defaultProjectId: projectId, updatedAt: new Date() },
    });

  return projectId;
}

export async function recomputeNavigatorScenariosForAllProUsers(params: {
  db: Db;
  includeInferred?: boolean;
}) {
  const proUsers = await params.db
    .select({ userId: users.id })
    .from(users)
    .where(eq(users.tier, "pro"));

  let totalUsers = 0;
  let totalScenarios = 0;
  for (const u of proUsers) {
    totalUsers++;
    const projectId = await ensurePersonalDefaultProjectId({ db: params.db, userId: u.userId });
    if (!projectId) continue;
    const res = await recomputeNavigatorScenariosForUser({
      db: params.db,
      projectId,
      userId: u.userId,
      includeInferred: params.includeInferred,
    });
    totalScenarios += res.total;
  }

  return { users: totalUsers, scenarios: totalScenarios };
}
