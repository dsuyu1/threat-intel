import {
  complianceControls,
  complianceMappings,
  kgRelations,
  navigatorActions,
  navigatorDetections,
  navigatorScenarios,
  projectComplianceFrameworks,
  projectComplianceSettings,
} from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

export type ComplianceFramework = "nist_csf_2" | "cis_v8" | "iso_27001";
export type ComplianceControlStatus = "covered" | "partial" | "gap";

export const COMPLIANCE_FRAMEWORKS: ComplianceFramework[] = ["nist_csf_2", "cis_v8", "iso_27001"];
const FRAMEWORK_SET = new Set<string>(COMPLIANCE_FRAMEWORKS);

export function isComplianceFramework(input: string): input is ComplianceFramework {
  return FRAMEWORK_SET.has(String(input ?? "").trim());
}

export function frameworkLabel(framework: string) {
  if (framework === "nist_csf_2") return "NIST CSF 2.0";
  if (framework === "cis_v8") return "CIS Controls v8";
  if (framework === "iso_27001") return "ISO 27001";
  return framework;
}

export function isSchemaOutOfDate(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? anyErr?.originalError?.code ?? "");
  if (code === "42P01" || code === "42703") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return (msg.includes('relation "') && msg.includes("does not exist")) || (msg.includes('column "') && msg.includes("does not exist"));
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export type ComplianceScenarioSignal = {
  id: string;
  title: string;
  inherent: number;
  coveragePct: number;
  residual: number;
  actionsDone: number;
  actionsTotal: number;
  detectionsTotal: number;
  computedAt: Date | null;
};

export type ComplianceControlRow = {
  controlId: string;
  title: string | null;
  status: ComplianceControlStatus;
  evidenceScenarioCount: number;
  bestCoveragePct: number;
  maxResidual: number;
  topScenarios: ComplianceScenarioSignal[];
};

export type ComplianceFrameworkDashboard = {
  framework: ComplianceFramework;
  label: string;
  hasControlCatalog: boolean;
  controlsTotal: number;
  coveredCount: number;
  partialCount: number;
  gapCount: number;
  coveragePct: number;
  controls: ComplianceControlRow[];
  topMappedScenarios: ComplianceScenarioSignal[];
  topUnmappedScenarios: ComplianceScenarioSignal[];
};

function rollupControlId(framework: ComplianceFramework, controlId: string) {
  const raw = String(controlId ?? "").trim();
  if (!raw) return raw;
  if (framework === "cis_v8") return raw.split(".")[0] ?? raw;
  if (framework === "nist_csf_2") return raw.split(".")[0] ?? raw;
  return raw;
}

function uniq<T>(items: T[]) {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

function sortByControlId(a: string, b: string) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

function statusFor(bestCoveragePct: number, evidenceScenarioCount: number): ComplianceControlStatus {
  if (evidenceScenarioCount <= 0) return "gap";
  if (bestCoveragePct >= 70) return "covered";
  return "partial";
}

export function statusClasses(status: ComplianceControlStatus) {
  if (status === "covered") return "border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200";
  if (status === "partial") return "border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200";
  return "border-rose-200 dark:border-rose-800/70 bg-rose-50/60 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200";
}

function safeCount(n: unknown) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

type Db = {
  select: any;
  delete: any;
  insert: any;
  update: any;
};

export async function getComplianceSettings(db: Db, projectId: string) {
  let schemaReady = true;
  let settings: { federalFunding: boolean; cyberInsurance: boolean } = { federalFunding: false, cyberInsurance: false };
  let frameworks: Array<{ framework: ComplianceFramework; source: "auto" | "manual"; isRequired: boolean; reasons: string[] }> = [];

  try {
    const [row] = await db
      .select({ federalFunding: projectComplianceSettings.federalFunding, cyberInsurance: projectComplianceSettings.cyberInsurance })
      .from(projectComplianceSettings)
      .where(eq(projectComplianceSettings.projectId, projectId))
      .limit(1);

    if (row) {
      settings = { federalFunding: Boolean(row.federalFunding), cyberInsurance: Boolean(row.cyberInsurance) };
    }
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    schemaReady = false;
  }

  try {
    const rows = await db
      .select({
        framework: projectComplianceFrameworks.framework,
        source: projectComplianceFrameworks.source,
        isRequired: projectComplianceFrameworks.isRequired,
        reasons: projectComplianceFrameworks.reasons,
      })
      .from(projectComplianceFrameworks)
      .where(eq(projectComplianceFrameworks.projectId, projectId))
      .orderBy(asc(projectComplianceFrameworks.framework))
      .limit(50);

    frameworks = rows
      .map((r: any) => ({
        framework: String(r.framework) as ComplianceFramework,
        source: String(r.source) === "auto" ? "auto" : "manual",
        isRequired: Boolean(r.isRequired),
        reasons: Array.isArray(r.reasons) ? (r.reasons as string[]).map(String) : [],
      }))
      .filter((r) => isComplianceFramework(r.framework));
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    schemaReady = false;
  }

  const enabled = uniq(frameworks.map((f) => f.framework));
  return { settings, frameworks, enabled, schemaReady };
}

export async function setComplianceSettings(
  db: Db,
  args: { projectId: string; federalFunding: boolean; cyberInsurance: boolean; enabledFrameworks: ComplianceFramework[] }
) {
  const now = new Date();

  // Upsert settings (manual update-first for compatibility with current drizzle usage patterns).
  try {
    const updated = await db
      .update(projectComplianceSettings)
      .set({
        federalFunding: args.federalFunding,
        cyberInsurance: args.cyberInsurance,
        updatedAt: now,
      })
      .where(eq(projectComplianceSettings.projectId, args.projectId))
      .returning({ projectId: projectComplianceSettings.projectId });

    if (!updated?.length) {
      await db.insert(projectComplianceSettings).values({
        projectId: args.projectId,
        federalFunding: args.federalFunding,
        cyberInsurance: args.cyberInsurance,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    throw err;
  }

  const required: Partial<Record<ComplianceFramework, string[]>> = {};
  if (args.federalFunding) required["nist_csf_2"] = ["federal_funding"];
  if (args.cyberInsurance) required["cis_v8"] = ["cyber_insurance"];

  const desired = new Map<ComplianceFramework, { source: "auto" | "manual"; isRequired: boolean; reasons: string[] }>();

  for (const framework of args.enabledFrameworks) {
    desired.set(framework, { source: "manual", isRequired: false, reasons: [] });
  }

  for (const framework of Object.keys(required) as ComplianceFramework[]) {
    desired.set(framework, { source: "auto", isRequired: true, reasons: required[framework] ?? [] });
  }

  const rows = Array.from(desired.entries()).map(([framework, v]) => ({
    projectId: args.projectId,
    framework,
    source: v.source as any,
    isRequired: v.isRequired,
    reasons: v.reasons,
    createdAt: now,
    updatedAt: now,
  }));

  // Replace all frameworks rows for this project.
  try {
    await db.delete(projectComplianceFrameworks).where(eq(projectComplianceFrameworks.projectId, args.projectId));
    if (rows.length) await db.insert(projectComplianceFrameworks).values(rows as any);
  } catch (err) {
    if (isSchemaOutOfDate(err)) throw err;
    throw err;
  }

  return { ok: true, enabled: rows.map((r) => r.framework) };
}

export async function computeComplianceFrameworkDashboard(db: Db, args: { projectId: string; framework: ComplianceFramework }) {
  const framework = args.framework;
  const label = frameworkLabel(framework);

  // Catalog (optional; we can still compute from mappings).
  let catalog: Array<{ controlId: string; title: string | null; sortOrder: number }> = [];
  let hasControlCatalog = false;
  try {
    const rows = await db
      .select({
        controlId: complianceControls.controlId,
        title: complianceControls.title,
        sortOrder: complianceControls.sortOrder,
      })
      .from(complianceControls)
      .where(eq(complianceControls.framework, framework as any))
      .orderBy(asc(complianceControls.sortOrder), asc(complianceControls.controlId))
      .limit(5000);
    catalog = rows.map((r: any) => ({
      controlId: String(r.controlId),
      title: r.title != null ? String(r.title) : null,
      sortOrder: safeCount(r.sortOrder),
    }));
    hasControlCatalog = catalog.length > 0;
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
  }

  // Mappings
  const mappings = (await db
    .select({
      sourceKind: complianceMappings.sourceKind,
      sourceId: complianceMappings.sourceId,
      controlId: complianceMappings.controlId,
    })
    .from(complianceMappings)
    .where(and(eq(complianceMappings.projectId, args.projectId), eq(complianceMappings.framework, framework as any)))
    .limit(50_000)) as Array<{ sourceKind: string; sourceId: string; controlId: string }>;

  type ScenarioRow = {
    id: string;
    title: string;
    score: number;
    targetKind: string;
    targetId: string;
    computedAt: Date | null;
  };

  const mappedScenarioIds = uniq(
    mappings
      .filter((m) => String(m.sourceKind) === "scenario")
      .map((m) => String(m.sourceId))
      .filter((s) => s)
  );
  const mappedTechniqueIds = uniq(
    mappings
      .filter((m) => String(m.sourceKind) === "technique")
      .map((m) => String(m.sourceId))
      .filter((s) => s)
  );
  const mitigationIds = uniq(
    mappings
      .filter((m) => String(m.sourceKind) === "mitigation")
      .map((m) => String(m.sourceId))
      .filter((s) => s)
  );

  const techniqueIdsByMitigationId = new Map<string, string[]>();
  if (mitigationIds.length) {
    const rows = (await db
      .select({ fromId: kgRelations.fromId, toId: kgRelations.toId })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "technique_mitigated_by"),
          eq(kgRelations.fromKind, "technique"),
          eq(kgRelations.toKind, "mitigation"),
          inArray(kgRelations.toId, mitigationIds)
        )
      )
      .limit(100_000)) as Array<{ fromId: string; toId: string }>;

    for (const r of rows) {
      const mid = String(r.toId);
      const tid = String(r.fromId);
      if (!mid || !tid) continue;
      const cur = techniqueIdsByMitigationId.get(mid) ?? [];
      cur.push(tid);
      techniqueIdsByMitigationId.set(mid, cur);
    }
  }

  const techniqueIdsFromMitigations = uniq(Array.from(techniqueIdsByMitigationId.values()).flat());
  const evidenceTechniqueIds = uniq([...mappedTechniqueIds, ...techniqueIdsFromMitigations]);

  const evidenceScenarioRows: ScenarioRow[] = [];
  if (mappedScenarioIds.length) {
    const rows = (await db
      .select({
        id: navigatorScenarios.id,
        title: navigatorScenarios.title,
        score: navigatorScenarios.score,
        targetKind: navigatorScenarios.targetKind,
        targetId: navigatorScenarios.targetId,
        computedAt: navigatorScenarios.computedAt,
      })
      .from(navigatorScenarios)
      .where(and(eq(navigatorScenarios.projectId, args.projectId), eq(navigatorScenarios.validationStatus, "validated" as any), inArray(navigatorScenarios.id, mappedScenarioIds)))
      .limit(5000)) as ScenarioRow[];
    evidenceScenarioRows.push(...rows);
  }

  if (evidenceTechniqueIds.length) {
    const rows = (await db
      .select({
        id: navigatorScenarios.id,
        title: navigatorScenarios.title,
        score: navigatorScenarios.score,
        targetKind: navigatorScenarios.targetKind,
        targetId: navigatorScenarios.targetId,
        computedAt: navigatorScenarios.computedAt,
      })
      .from(navigatorScenarios)
      .where(
        and(
          eq(navigatorScenarios.projectId, args.projectId),
          eq(navigatorScenarios.validationStatus, "validated" as any),
          eq(navigatorScenarios.targetKind, "technique"),
          inArray(navigatorScenarios.targetId, evidenceTechniqueIds)
        )
      )
      .limit(20_000)) as ScenarioRow[];
    evidenceScenarioRows.push(...rows);
  }

  // Candidate scenarios for "unmapped risk" UX.
  const candidateScenarioRows = (await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      score: navigatorScenarios.score,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.projectId, args.projectId), eq(navigatorScenarios.validationStatus, "validated" as any)))
    .orderBy(desc(navigatorScenarios.score), desc(navigatorScenarios.computedAt))
    .limit(700)) as ScenarioRow[];

  const scenarioByIdUniq = new Map<string, ScenarioRow>();
  for (const r of [...candidateScenarioRows, ...evidenceScenarioRows]) {
    const id = String((r as any)?.id ?? "");
    if (!id) continue;
    if (!scenarioByIdUniq.has(id)) scenarioByIdUniq.set(id, r);
  }

  const scenarioRows = Array.from(scenarioByIdUniq.values());

  const scenarioById = new Map<string, { id: string; title: string; score: number; targetKind: string; targetId: string; computedAt: Date | null }>();
  const scenarioIds: string[] = [];
  const techniqueScenarioIdsByTechniqueId = new Map<string, string[]>();

  for (const s of scenarioRows) {
    const id = String(s.id);
    scenarioIds.push(id);
    const row = {
      id,
      title: String(s.title ?? ""),
      score: safeCount(s.score),
      targetKind: String(s.targetKind ?? ""),
      targetId: String(s.targetId ?? ""),
      computedAt: (s as any).computedAt ?? null,
    };
    scenarioById.set(id, row);
    if (row.targetKind === "technique" && row.targetId) {
      const cur = techniqueScenarioIdsByTechniqueId.get(row.targetId) ?? [];
      cur.push(id);
      techniqueScenarioIdsByTechniqueId.set(row.targetId, cur);
    }
  }

  const actionCountsByScenarioId = new Map<string, { total: number; done: number }>();
  const detectionCountsByScenarioId = new Map<string, number>();

  if (scenarioIds.length) {
    const actionRows = await db
      .select({
        scenarioId: navigatorActions.scenarioId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${navigatorActions.status} = 'done' then 1 else 0 end)`,
      })
      .from(navigatorActions)
      .where(and(eq(navigatorActions.projectId, args.projectId), inArray(navigatorActions.scenarioId, scenarioIds)))
      .groupBy(navigatorActions.scenarioId)
      .limit(10_000);

    for (const r of actionRows) {
      actionCountsByScenarioId.set(String(r.scenarioId), { total: safeCount(r.total), done: safeCount(r.done) });
    }

    const detectionRows = await db
      .select({ scenarioId: navigatorDetections.scenarioId, total: sql<number>`count(*)` })
      .from(navigatorDetections)
      .where(and(eq(navigatorDetections.projectId, args.projectId), inArray(navigatorDetections.scenarioId, scenarioIds)))
      .groupBy(navigatorDetections.scenarioId)
      .limit(10_000);

    for (const r of detectionRows) detectionCountsByScenarioId.set(String(r.scenarioId), safeCount(r.total));
  }

  const signalByScenarioId = new Map<string, ComplianceScenarioSignal>();
  for (const s of scenarioById.values()) {
    const actions = actionCountsByScenarioId.get(s.id) ?? { total: 0, done: 0 };
    const detectionsTotal = detectionCountsByScenarioId.get(s.id) ?? 0;
    const coverage01 = clamp01(0.25 * (actions.total ? actions.done / actions.total : 0) + 0.75 * (detectionsTotal ? 1 : 0));
    const coveragePct = Math.round(coverage01 * 100);
    const inherent = safeCount(s.score);
    const residual = Math.round(inherent * (1 - 0.45 * coverage01));
    signalByScenarioId.set(s.id, {
      id: s.id,
      title: s.title,
      inherent,
      coveragePct,
      residual,
      actionsDone: safeCount(actions.done),
      actionsTotal: safeCount(actions.total),
      detectionsTotal,
      computedAt: s.computedAt ?? null,
    });
  }

  const evidenceScenarioIdsByControlId = new Map<string, Set<string>>();
  const evidenceScenarioIds = new Set<string>();

  for (const m of mappings) {
    const sourceKind = String(m.sourceKind);
    const sourceId = String(m.sourceId);
    const rawControlId = String(m.controlId);
    const controlId = rollupControlId(framework, rawControlId);
    if (!controlId) continue;

    let scenarioIdsForMapping: string[] = [];
    if (sourceKind === "scenario") {
      scenarioIdsForMapping = scenarioById.has(sourceId) ? [sourceId] : [];
    } else if (sourceKind === "technique") {
      scenarioIdsForMapping = techniqueScenarioIdsByTechniqueId.get(sourceId) ?? [];
    } else if (sourceKind === "mitigation") {
      const techniqueIds = techniqueIdsByMitigationId.get(sourceId) ?? [];
      const ids: string[] = [];
      for (const tid of techniqueIds) ids.push(...(techniqueScenarioIdsByTechniqueId.get(tid) ?? []));
      scenarioIdsForMapping = ids;
    }

    if (!scenarioIdsForMapping.length) continue;

    const set = evidenceScenarioIdsByControlId.get(controlId) ?? new Set<string>();
    for (const sid of scenarioIdsForMapping) {
      if (!signalByScenarioId.has(sid)) continue;
      set.add(sid);
      evidenceScenarioIds.add(sid);
    }
    evidenceScenarioIdsByControlId.set(controlId, set);
  }

  let controls: Array<{ controlId: string; title: string | null; sortOrder: number }> = catalog;
  if (!controls.length) {
    const derived = uniq(mappings.map((m) => rollupControlId(framework, String(m.controlId))).filter(Boolean)).sort(sortByControlId);
    controls = derived.map((id) => ({ controlId: id, title: null, sortOrder: 0 }));
  }

  const controlRows: ComplianceControlRow[] = controls
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || sortByControlId(a.controlId, b.controlId))
    .map((c) => {
      const scenarioIdSet = evidenceScenarioIdsByControlId.get(c.controlId) ?? new Set<string>();
      const scenarios = Array.from(scenarioIdSet)
        .map((id) => signalByScenarioId.get(id)!)
        .filter(Boolean);

      let bestCoveragePct = 0;
      let maxResidual = 0;
      for (const s of scenarios) {
        if (s.coveragePct > bestCoveragePct) bestCoveragePct = s.coveragePct;
        if (s.residual > maxResidual) maxResidual = s.residual;
      }

      const topScenarios = scenarios.sort((a, b) => b.residual - a.residual || b.coveragePct - a.coveragePct).slice(0, 3);

      return {
        controlId: c.controlId,
        title: c.title,
        status: statusFor(bestCoveragePct, scenarios.length),
        evidenceScenarioCount: scenarios.length,
        bestCoveragePct,
        maxResidual,
        topScenarios,
      };
    });

  const controlsTotal = controlRows.length;
  const coveredCount = controlRows.filter((c) => c.status === "covered").length;
  const partialCount = controlRows.filter((c) => c.status === "partial").length;
  const gapCount = controlRows.filter((c) => c.status === "gap").length;
  const coveragePct = controlsTotal ? Math.round(((coveredCount + 0.5 * partialCount) / controlsTotal) * 100) : 0;

  const topMappedScenarios = Array.from(evidenceScenarioIds)
    .map((id) => signalByScenarioId.get(id)!)
    .filter(Boolean)
    .sort((a, b) => b.residual - a.residual || b.coveragePct - a.coveragePct)
    .slice(0, 20);

  const topUnmappedScenarios = candidateScenarioRows
    .map((s) => String(s.id))
    .filter((id) => !evidenceScenarioIds.has(id))
    .map((id) => signalByScenarioId.get(id)!)
    .filter(Boolean)
    .sort((a, b) => b.residual - a.residual || b.coveragePct - a.coveragePct)
    .slice(0, 20);

  const out: ComplianceFrameworkDashboard = {
    framework,
    label,
    hasControlCatalog,
    controlsTotal,
    coveredCount,
    partialCount,
    gapCount,
    coveragePct,
    controls: controlRows,
    topMappedScenarios,
    topUnmappedScenarios,
  };

  return out;
}
