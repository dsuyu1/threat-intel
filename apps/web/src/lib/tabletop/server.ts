import "server-only";

import { getDb, kgEntities, kgRelations, navigatorConfigs, navigatorScenarios, tabletopExercises, tabletopInjects, userStack } from "@ti/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { generateText } from "../ai";
import { dedupePreserveOrder, injectCountForDuration, pickActor, pickInitialAccess, pickTechniqueChain, tPlusSchedule, type ActorCandidate } from "./selection";
import type { TabletopAiOutput, TabletopGenerateInput } from "./types";

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

function toNonEmptyString(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function coerceStringArray(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function extractJsonObject(text: string) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) throw new Error("AI output is not valid JSON");
  return s.slice(start, end + 1);
}

function normalizeAiOutput(raw: unknown): TabletopAiOutput {
  const obj = raw as any;
  const narrative = toNonEmptyString(obj?.narrative);
  const facilitatorGuide = toNonEmptyString(obj?.facilitatorGuide);
  const aarTemplate = toNonEmptyString(obj?.aarTemplate);
  const injects = Array.isArray(obj?.injects) ? obj.injects : null;
  const roles = Array.isArray(obj?.roles) ? obj.roles : null;

  if (!narrative) throw new Error("AI output missing narrative");
  if (!facilitatorGuide) throw new Error("AI output missing facilitatorGuide");
  if (!aarTemplate) throw new Error("AI output missing aarTemplate");
  if (!injects?.length) throw new Error("AI output missing injects[]");
  if (!roles?.length) throw new Error("AI output missing roles[]");

  const normalizedInjects = injects.map((i: any) => ({
    title: String(i?.title ?? "").trim(),
    tPlus: Number(i?.tPlus ?? i?.t_plus ?? 0),
    situation: String(i?.situation ?? "").trim(),
    techniqueId: toNonEmptyString(i?.techniqueId ?? i?.technique_id),
    questions: coerceStringArray(i?.questions ?? i?.discussionQuestions),
    criteria: coerceStringArray(i?.criteria ?? i?.evaluationCriteria),
    curveballs: Array.isArray(i?.curveballs) ? coerceStringArray(i?.curveballs) : null,
    facilitatorTips: toNonEmptyString(i?.facilitatorTips),
  }));

  for (const i of normalizedInjects) {
    if (!i.title) throw new Error("AI output inject missing title");
    if (!Number.isFinite(i.tPlus) || i.tPlus < 0) throw new Error("AI output inject has invalid tPlus");
    if (!i.situation) throw new Error("AI output inject missing situation");
    if (!i.questions.length) throw new Error("AI output inject missing questions[]");
    if (!i.criteria.length) throw new Error("AI output inject missing criteria[]");
  }

  const normalizedRoles = roles.map((r: any) => ({
    roleName: String(r?.roleName ?? r?.role_name ?? "").trim(),
    briefing: String(r?.briefing ?? "").trim(),
    responsibilities: coerceStringArray(r?.responsibilities ?? r?.keyResponsibilities),
    documentsToHave: coerceStringArray(r?.documentsToHave ?? r?.documents_to_have),
  }));

  for (const r of normalizedRoles) {
    if (!r.roleName) throw new Error("AI output role missing roleName");
    if (!r.briefing) throw new Error("AI output role missing briefing");
  }

  return {
    narrative,
    facilitatorGuide,
    aarTemplate,
    injects: normalizedInjects,
    roles: normalizedRoles,
  };
}

function buildPrompt(params: {
  input: TabletopGenerateInput;
  actor: { actorId: string; actorName: string; actorDescription: string | null };
  stack: Array<{ technology: string; versionRange: string | null }>;
  selection: {
    initialAccess: { cveId: string | null; stackTech: { technology: string; versionRange?: string | null } | null };
    techniqueChain: string[];
    injectSchedule: Array<{ sequence: number; tPlus: number; techniqueId: string | null }>;
  };
  navigatorGaps: Array<{ id: string; title: string; summary: string | null; score: number; validationStatus: string; targetKind: string; targetId: string }>;
  riskTolerance: { operational: number; financial: number; compliance: number; reputational: number } | null;
}) {
  const maxNarrativeChars = 16_000;
  const maxInjects = 10;

  const risk = params.riskTolerance
    ? `Risk tolerance thresholds (0-100): operational=${params.riskTolerance.operational}, financial=${params.riskTolerance.financial}, compliance=${params.riskTolerance.compliance}, reputational=${params.riskTolerance.reputational}.`
    : "Risk tolerance thresholds: unavailable (use reasonable defaults).";

  const gaps = params.navigatorGaps
    .slice(0, 10)
    .map((g) => `- (${g.score}) [${g.validationStatus}] ${g.targetKind}:${g.targetId} — ${g.title}${g.summary ? ` — ${g.summary}` : ""}`)
    .join("\n");

  const stack = params.stack
    .slice(0, 20)
    .map((s) => `- ${s.technology}${s.versionRange ? ` (${s.versionRange})` : ""}`)
    .join("\n");

  const injectBackbone = params.selection.injectSchedule
    .map((x) => `- seq=${x.sequence} tPlus=${x.tPlus} techniqueId=${x.techniqueId ?? "null"}`)
    .join("\n");

  return `
You are generating a cybersecurity tabletop exercise package for an enterprise audience.

Hard requirements:
- Output MUST be valid JSON only (no markdown, no backticks).
- Keep "narrative" under ${maxNarrativeChars} characters.
- Provide exactly ${params.selection.injectSchedule.length} injects.
- Do not exceed ${maxInjects} injects.
- Each inject MUST include at least 3 discussion questions and at least 3 evaluation criteria.
- Keep content grounded in the provided actor, stack, and Navigator gaps. Do not invent CVEs/techniques outside the provided lists unless absolutely necessary.

Exercise inputs:
- scenarioType: ${params.input.scenarioType}
- difficultyLevel: ${params.input.difficultyLevel}
- durationMinutes: ${params.input.durationMinutes}
- complianceTag: ${params.input.complianceTag ? JSON.stringify(params.input.complianceTag) : "null"}

Actor:
- actorId: ${params.actor.actorId}
- actorName: ${params.actor.actorName}
- description: ${params.actor.actorDescription ? params.actor.actorDescription : "n/a"}

Stack (project-scoped):
${stack || "- (none provided)"}

Navigator gaps to incorporate (prioritize these):
${gaps || "- (none available)"}

Initial access candidate:
- cveId: ${params.selection.initialAccess.cveId ?? "null"}
- boundStackTech: ${params.selection.initialAccess.stackTech ? params.selection.initialAccess.stackTech.technology : "null"}

Technique chain (ordered, prefer these techniqueIds):
${params.selection.techniqueChain.map((t) => `- ${t}`).join("\n") || "- (none)"}

Inject backbone (you must follow this timing and technique mapping):
${injectBackbone}

${risk}

Return JSON with EXACTLY this shape:
{
  "narrative": "string",
  "injects": [
    {
      "title": "string",
      "tPlus": 0,
      "situation": "string",
      "techniqueId": "TXXXX" | null,
      "questions": ["string", "..."],
      "criteria": ["string", "..."],
      "curveballs": ["string", "..."] | null,
      "facilitatorTips": "string" | null
    }
  ],
  "roles": [
    {
      "roleName": "string",
      "briefing": "string",
      "responsibilities": ["string", "..."],
      "documentsToHave": ["string", "..."]
    }
  ],
  "facilitatorGuide": "string",
  "aarTemplate": "string"
}
`.trim();
}

export async function generateTabletopPackage(params: {
  projectId: string;
  userId: string;
  input: TabletopGenerateInput;
}) {
  const db = getDb();

  const durationMinutes = Math.max(30, Math.min(480, Math.trunc(Number(params.input.durationMinutes))));
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("durationMinutes must be a positive integer");

  const input = { ...params.input, durationMinutes };
  const complianceTag = toNonEmptyString(input.complianceTag) ?? null;

  const [cfg] = await db
    .select({ sector: navigatorConfigs.sector })
    .from(navigatorConfigs)
    .where(eq(navigatorConfigs.projectId, params.projectId))
    .limit(1);
  const projectSector = String(cfg?.sector ?? "all");

  const stackRows = await db
    .select({ technology: userStack.technology, versionRange: userStack.versionRange })
    .from(userStack)
    .where(eq(userStack.projectId, params.projectId))
    .orderBy(desc(userStack.technology))
    .limit(50);
  const stack = stackRows.map((s) => ({ technology: String(s.technology), versionRange: s.versionRange ?? null }));

  const gapRows = await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      score: navigatorScenarios.score,
      validationStatus: navigatorScenarios.validationStatus,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      attributes: navigatorScenarios.attributes,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
    })
    .from(navigatorScenarios)
    .where(
      and(
        eq(navigatorScenarios.projectId, params.projectId),
        inArray(navigatorScenarios.validationStatus, ["unvalidated", "in_progress"] as any)
      )
    )
    .orderBy(desc(navigatorScenarios.score))
    .limit(80);

  const gapTechniqueIds = dedupePreserveOrder(gapRows.filter((r) => r.targetKind === "technique").map((r) => r.targetId));
  const gapCveIds = dedupePreserveOrder(gapRows.filter((r) => r.targetKind === "cve").map((r) => r.targetId));
  const navigatorScenarioIds = gapRows.slice(0, 20).map((r) => r.id);

  // Best-effort: use prior exercises for diversity. If the tables aren't migrated yet, we surface a friendly message upstream.
  let recentActorScenarioPairs: Array<{ actorId: string; scenarioType: string }> = [];
  let recentTechniqueIds: string[] = [];
  try {
    recentActorScenarioPairs = await db
      .select({ actorId: tabletopExercises.actorId, scenarioType: tabletopExercises.scenarioType })
      .from(tabletopExercises)
      .where(eq(tabletopExercises.projectId, params.projectId))
      .orderBy(desc(tabletopExercises.createdAt))
      .limit(25);

    const recentInjectRows = await db
      .select({ techniqueId: tabletopInjects.attackTechniqueId })
      .from(tabletopInjects)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopInjects.exerciseId))
      .where(eq(tabletopExercises.projectId, params.projectId))
      .orderBy(desc(tabletopExercises.createdAt))
      .limit(200);
    recentTechniqueIds = recentInjectRows.map((r) => String(r.techniqueId ?? "")).filter(Boolean);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  // Actor selection
  const actorMode = input.actorMode ?? (input.actorId ? "chosen" : "suggest");
  const explicitActorId = toNonEmptyString(input.actorId);

  const actorFromKg = async (actorId: string) => {
    const [row] = await db
      .select({ name: kgEntities.name, description: kgEntities.description })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, actorId)))
      .limit(1);
    return row ?? null;
  };

  const actor = await (async () => {
    if (actorMode === "chosen" && explicitActorId) {
      const kg = await actorFromKg(explicitActorId);
      if (kg?.name) return { actorId: explicitActorId, actorName: kg.name, actorDescription: kg.description ?? null };

      const [fallback] = await db
        .select({ actorName: sql<string>`min(${navigatorScenarios.actorName})` })
        .from(navigatorScenarios)
        .where(and(eq(navigatorScenarios.projectId, params.projectId), eq(navigatorScenarios.actorId, explicitActorId)))
        .groupBy(navigatorScenarios.actorId)
        .limit(1);
      const name = String((fallback as any)?.actorName ?? "").trim();
      if (!name) throw new Error("Unknown actorId");
      return { actorId: explicitActorId, actorName: name, actorDescription: null };
    }

    const actorIds = await db
      .select({ actorId: navigatorScenarios.actorId, actorName: sql<string>`min(${navigatorScenarios.actorName})` })
      .from(navigatorScenarios)
      .where(eq(navigatorScenarios.projectId, params.projectId))
      .groupBy(navigatorScenarios.actorId)
      .orderBy(desc(sql`max(${navigatorScenarios.score})`))
      .limit(250);

    const candidateIds = actorIds.map((r) => r.actorId).filter(Boolean);
    if (!candidateIds.length) throw new Error("No actors found for this project");

    const relRows = await db
      .select({
        type: kgRelations.type,
        fromId: kgRelations.fromId,
        toId: kgRelations.toId,
      })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.fromKind, "actor"),
          inArray(kgRelations.fromId, candidateIds),
          inArray(kgRelations.type, ["actor_uses_technique", "actor_exploits_cve", "actor_targets_sector"])
        )
      )
      .limit(50_000);

    const byActor: Map<string, ActorCandidate> = new Map();
    for (const row of actorIds) {
      const id = String(row.actorId ?? "").trim();
      if (!id) continue;
      byActor.set(id, {
        actorId: id,
        actorName: String((row as any).actorName ?? id),
        usesTechniques: [],
        exploitsCves: [],
        targetsSectors: [],
      });
    }

    for (const r of relRows) {
      const a = byActor.get(String(r.fromId));
      if (!a) continue;
      if (r.type === "actor_uses_technique") a.usesTechniques.push(String(r.toId));
      if (r.type === "actor_exploits_cve") a.exploitsCves.push(String(r.toId));
      if (r.type === "actor_targets_sector") a.targetsSectors.push(String(r.toId));
    }

    const candidates = Array.from(byActor.values()).map((c) => ({
      ...c,
      usesTechniques: dedupePreserveOrder(c.usesTechniques),
      exploitsCves: dedupePreserveOrder(c.exploitsCves),
      targetsSectors: dedupePreserveOrder(c.targetsSectors),
    }));

    const picked = pickActor({
      candidates,
      gapTechniqueIds,
      gapCveIds,
      projectSector,
      recentActorScenarioPairs,
      scenarioType: input.scenarioType,
    });
    const chosen = picked ?? candidates[0]!;

    const kg = await actorFromKg(chosen.actorId);
    return {
      actorId: chosen.actorId,
      actorName: kg?.name ?? chosen.actorName,
      actorDescription: kg?.description ?? null,
    };
  })();

  const actorRelRows = await db
    .select({ type: kgRelations.type, toId: kgRelations.toId })
    .from(kgRelations)
    .where(and(eq(kgRelations.fromKind, "actor"), eq(kgRelations.fromId, actor.actorId), inArray(kgRelations.type, ["actor_uses_technique", "actor_exploits_cve"])))
    .limit(10_000);

  const actorTechniqueIds = dedupePreserveOrder(actorRelRows.filter((r) => r.type === "actor_uses_technique").map((r) => r.toId));
  const actorCveIds = dedupePreserveOrder(actorRelRows.filter((r) => r.type === "actor_exploits_cve").map((r) => r.toId));

  const injectCount = injectCountForDuration(durationMinutes);
  const times = tPlusSchedule(durationMinutes, injectCount);
  const techniqueChain = pickTechniqueChain({ injectCount, gapTechniqueIds, actorTechniqueIds, recentTechniqueIds });

  // Prefer a CVE gap with both actor intersection and Navigator's stackMatch when present.
  const stackTechSet = new Set(stack.map((s) => s.technology.toLowerCase()));
  const actorCveSet = new Set(actorCveIds);
  const preferredGapCve = gapRows.find((r) => {
    if (r.targetKind !== "cve") return false;
    if (!actorCveSet.has(r.targetId)) return false;
    const mt = String((r.attributes as any)?.stackMatch?.matchedTechnology ?? "").toLowerCase();
    if (!mt) return false;
    return stackTechSet.has(mt);
  })?.targetId;

  const initialAccess = pickInitialAccess({
    gapCveIds: preferredGapCve ? [preferredGapCve, ...gapCveIds] : gapCveIds,
    actorCveIds,
    stackTechs: stack,
  });

  const injectSchedule = times.map((tPlus, i) => ({
    sequence: i + 1,
    tPlus,
    techniqueId: techniqueChain[i] ?? null,
  }));

  // Risk tolerance is optional; used only for prompt grounding if present.
  let riskTolerance: { operational: number; financial: number; compliance: number; reputational: number } | null = null;
  try {
    const { riskToleranceProfiles } = await import("@ti/db");
    const [rt] = await db
      .select({
        operational: riskToleranceProfiles.operationalThreshold,
        financial: riskToleranceProfiles.financialThreshold,
        compliance: riskToleranceProfiles.complianceThreshold,
        reputational: riskToleranceProfiles.reputationalThreshold,
      })
      .from(riskToleranceProfiles)
      .where(eq(riskToleranceProfiles.projectId, params.projectId))
      .limit(1);
    if (rt) {
      riskTolerance = {
        operational: Number(rt.operational ?? 60),
        financial: Number(rt.financial ?? 60),
        compliance: Number(rt.compliance ?? 50),
        reputational: Number(rt.reputational ?? 50),
      };
    }
  } catch (err) {
    if (!isMissingTable(err)) {
      // ignore, keep prompt simple
    }
  }

  const prompt = buildPrompt({
    input: { ...input, complianceTag },
    actor,
    stack,
    selection: { initialAccess, techniqueChain, injectSchedule },
    navigatorGaps: gapRows.map((g) => ({
      id: g.id,
      title: g.title,
      summary: g.summary ?? null,
      score: g.score,
      validationStatus: g.validationStatus,
      targetKind: g.targetKind,
      targetId: g.targetId,
    })),
    riskTolerance,
  });

  const raw = await generateText({ prompt, temperature: 0.25, maxTokens: 2400 });
  const parsed = JSON.parse(extractJsonObject(raw));
  const ai = normalizeAiOutput(parsed);

  // Enforce inject schedule count/tPlus invariants.
  if (ai.injects.length !== injectSchedule.length) {
    throw new Error(`AI returned ${ai.injects.length} inject(s), expected ${injectSchedule.length}`);
  }
  for (let i = 0; i < injectSchedule.length; i++) {
    ai.injects[i] = { ...ai.injects[i], tPlus: injectSchedule[i]!.tPlus, techniqueId: injectSchedule[i]!.techniqueId };
  }

  const title =
    toNonEmptyString(input.title) ??
    `${actor.actorName} — ${input.scenarioType.replaceAll("_", " ")} tabletop (${durationMinutes}m)`;

  return {
    actor,
    title,
    complianceTag,
    generationInputs: {
      stack,
      navigatorScenarioIds,
      techniqueIds: techniqueChain,
      cveIds: initialAccess.cveId ? [initialAccess.cveId] : [],
      sector: projectSector,
      geo: null,
    },
    ai,
    injectSchedule,
  };
}
