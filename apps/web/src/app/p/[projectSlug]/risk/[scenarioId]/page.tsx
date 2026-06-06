export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  complianceMappings,
  getDb,
  kgEntities,
  kgRelations,
  navigatorActions,
  navigatorDetections,
  navigatorScenarios,
  riskEntries,
  riskToleranceProfiles,
} from "@ti/db";
import { and, eq, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { ComplianceMappingQuickAdd } from "../../../../../components/risk/ComplianceMappingQuickAdd";
import { RiskFairLiteEditor } from "../../../../../components/risk/RiskFairLiteEditor";
import { RiskEntryEditor } from "../../../../../components/risk/RiskEntryEditor";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import {
  extractNavigatorDrivers,
  impactFromCvssScore,
  impactFromPrimaryTactic,
  likelihoodFromNavigatorWhy,
  riskLevelFromScore,
  type RiskLevel,
} from "../../../../../lib/risk";
import { getViewerContext } from "../../../../../lib/tenancy";
import { fixText } from "../../../../../lib/text";

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

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

function levelClasses(level: RiskLevel) {
  if (level === "critical")
    return "border-red-300/70 dark:border-red-700/60 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-200";
  if (level === "high")
    return "border-orange-300/70 dark:border-orange-700/60 bg-orange-50/60 dark:bg-orange-950/20 text-orange-700 dark:text-orange-200";
  if (level === "medium")
    return "border-amber-300/70 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200";
  return "border-emerald-300/70 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-200";
}

function frameworkLabel(framework: string) {
  if (framework === "nist_csf_2") return "NIST CSF 2.0";
  if (framework === "cis_v8") return "CIS v8";
  if (framework === "iso_27001") return "ISO 27001";
  return framework;
}

export default async function RiskEntryPage({
  params,
}: {
  params: Promise<{ projectSlug: string; scenarioId: string }>;
}) {
  const { projectSlug, scenarioId } = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Risk</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Risk management is available on Pro.</p>
      </div>
    );
  }

  const [scenario] = await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      scenarioType: navigatorScenarios.scenarioType,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      primaryTactic: navigatorScenarios.primaryTactic,
      validationStatus: navigatorScenarios.validationStatus,
      whyJson: navigatorScenarios.whyJson,
      attributes: navigatorScenarios.attributes,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
    .limit(1);

  if (!scenario) notFound();

  const isValidated = scenario.validationStatus === "validated";

  const defaultTolerance = {
    operational: 60,
    financial: 60,
    compliance: 50,
    reputational: 50,
  };
  let tolerance = { ...defaultTolerance };

  try {
    const [row] = await db
      .select({
        operational: riskToleranceProfiles.operationalThreshold,
        financial: riskToleranceProfiles.financialThreshold,
        compliance: riskToleranceProfiles.complianceThreshold,
        reputational: riskToleranceProfiles.reputationalThreshold,
      })
      .from(riskToleranceProfiles)
      .where(eq(riskToleranceProfiles.projectId, ctx.project.id))
      .limit(1);

    if (row) {
      tolerance = {
        operational: Number(row.operational ?? defaultTolerance.operational),
        financial: Number(row.financial ?? defaultTolerance.financial),
        compliance: Number(row.compliance ?? defaultTolerance.compliance),
        reputational: Number(row.reputational ?? defaultTolerance.reputational),
      };
    }
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01" && code !== "42703") throw err;
  }

  // Pull CVSS for CVE targets.
  let cvssScore: number | null = null;
  if (scenario.targetKind === "cve") {
    const [cve] = await db
      .select({ attributes: kgEntities.attributes })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, "cve"), eq(kgEntities.entityId, scenario.targetId)))
      .limit(1);
    const attrs = coerceJson(cve?.attributes) ?? cve?.attributes;
    const score = Number((attrs as any)?.cvss?.score ?? NaN);
    cvssScore = Number.isFinite(score) ? score : null;
  }

  const likelihood01 = likelihoodFromNavigatorWhy(scenario.whyJson);
  const drivers = extractNavigatorDrivers(scenario.whyJson);
  const impact =
    scenario.targetKind === "cve"
      ? impactFromCvssScore(cvssScore)
      : impactFromPrimaryTactic(scenario.primaryTactic ?? null);
  const impact10 =
    scenario.targetKind === "cve"
      ? cvssScore ?? Number((impact.impact01 * 10).toFixed(1))
      : Number((impact.impact01 * 10).toFixed(1));

  const inherent = Math.round(likelihood01 * impact.impact01 * 100);

  let actionsTotal = 0;
  let actionsDone = 0;
  let detectionsTotal = 0;

  try {
    const [a] = await db
      .select({
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${navigatorActions.status} = 'done' then 1 else 0 end)`,
      })
      .from(navigatorActions)
      .where(and(eq(navigatorActions.projectId, ctx.project.id), eq(navigatorActions.scenarioId, scenario.id)))
      .groupBy(navigatorActions.scenarioId)
      .limit(1);
    actionsTotal = Number(a?.total ?? 0);
    actionsDone = Number(a?.done ?? 0);
  } catch {
    // best-effort
  }

  try {
    const [d] = await db
      .select({ total: sql<number>`count(*)` })
      .from(navigatorDetections)
      .where(and(eq(navigatorDetections.projectId, ctx.project.id), eq(navigatorDetections.scenarioId, scenario.id)))
      .groupBy(navigatorDetections.scenarioId)
      .limit(1);
    detectionsTotal = Number(d?.total ?? 0);
  } catch {
    // best-effort
  }

  let riskEntry:
    | {
        status: string;
        category: string;
        owner: string | null;
        notes: string | null;
        fairLef: number | null;
        fairLmLow: number | null;
        fairLmHigh: number | null;
      }
    | null = null;

  try {
    const [row] = await db
      .select({
        status: riskEntries.status,
        category: riskEntries.category,
        owner: riskEntries.owner,
        notes: riskEntries.notes,
        fairLef: riskEntries.fairLef,
        fairLmLow: riskEntries.fairLmLow,
        fairLmHigh: riskEntries.fairLmHigh,
      })
      .from(riskEntries)
      .where(and(eq(riskEntries.projectId, ctx.project.id), eq(riskEntries.scenarioId, scenario.id)))
      .limit(1);
    riskEntry = row
      ? {
          status: String(row.status ?? "open"),
          category: String(row.category ?? "operational"),
          owner: row.owner ?? null,
          notes: row.notes ?? null,
          fairLef: row.fairLef != null ? Number(row.fairLef) : null,
          fairLmLow: row.fairLmLow != null ? Number(row.fairLmLow) : null,
          fairLmHigh: row.fairLmHigh != null ? Number(row.fairLmHigh) : null,
        }
      : null;
  } catch {
    // best-effort
  }

  const coverage01 = Math.max(
    0,
    Math.min(1, 0.25 * (actionsTotal ? actionsDone / actionsTotal : 0) + 0.75 * (detectionsTotal ? 1 : 0))
  );
  const residual = Math.round(inherent * (1 - 0.45 * coverage01));

  const category = (riskEntry?.category ?? "operational") as keyof typeof tolerance;
  const toleranceThreshold = tolerance[category] ?? 60;
  const overTolerance = residual >= toleranceThreshold;

  const level = riskLevelFromScore(inherent);

  const techniqueId = scenario.targetKind === "technique" ? scenario.targetId : null;
  const mitigationIds: string[] = [];
  if (techniqueId) {
    const rows = await db
      .select({ id: kgRelations.toId })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "technique_mitigated_by_mitigation"),
          eq(kgRelations.fromKind, "technique"),
          eq(kgRelations.toKind, "mitigation"),
          eq(kgRelations.fromId, techniqueId)
        )
      )
      .limit(50);
    for (const r of rows) mitigationIds.push(r.id);
  }

  const mappingRows = await db
    .select({
      id: complianceMappings.id,
      framework: complianceMappings.framework,
      sourceKind: complianceMappings.sourceKind,
      sourceId: complianceMappings.sourceId,
      controlId: complianceMappings.controlId,
      controlTitle: complianceMappings.controlTitle,
    })
    .from(complianceMappings)
    .where(eq(complianceMappings.projectId, ctx.project.id))
    .limit(400);

  const relatedSources: Array<{ kind: "scenario" | "technique" | "mitigation"; id: string; label: string }> = [
    { kind: "scenario", id: scenario.id, label: `Scenario · ${scenario.id}` },
  ];
  if (techniqueId) relatedSources.push({ kind: "technique", id: techniqueId, label: `Technique · ${techniqueId}` });
  for (const mid of mitigationIds.slice(0, 12)) {
    relatedSources.push({ kind: "mitigation", id: mid, label: `Mitigation · ${mid}` });
  }

  const mappingCountsByFramework = new Map<string, number>();
  for (const m of mappingRows) {
    const key = String(m.framework);
    mappingCountsByFramework.set(key, (mappingCountsByFramework.get(key) ?? 0) + 1);
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${projectSlug}/risk`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Risk register
        </Link>
        <Link
          href={`/p/${projectSlug}/navigator/scenarios/${scenario.id}`}
          className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
        >
          Open in Navigator →
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${levelClasses(
              level
            )}`}
          >
            {level}
          </span>
          <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            inherent {nf(inherent)} · residual {nf(residual)}
          </span>
          {overTolerance ? (
            <span className="text-xs text-red-700 dark:text-red-300">over tolerance (≥ {nf(toleranceThreshold)})</span>
          ) : (
            <span className="text-xs text-zinc-500">tolerance {nf(toleranceThreshold)}</span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{fixText(scenario.title)}</h1>
        {scenario.summary ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{fixText(scenario.summary)}</p> : null}
        <div className="text-xs text-zinc-500">
          Actor: <span className="font-medium text-zinc-700 dark:text-zinc-300">{fixText(String(scenario.actorName ?? scenario.actorId))}</span>{" "}
          · Target: <span className="font-medium text-zinc-700 dark:text-zinc-300">{fixText(String(scenario.targetName ?? scenario.targetId))}</span>{" "}
          · Tactic: <span className="font-medium text-zinc-700 dark:text-zinc-300">{fixText(String(scenario.primaryTactic ?? ""))}</span>
          {!isValidated ? (
            <span className="ml-2 text-amber-700 dark:text-amber-300">not validated</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader title="Likelihood" description="From Navigator drivers" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(Math.round(likelihood01 * 100))}%
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              Actor relevance {nf(Math.round((drivers.actorRelevance ?? 0) * 100))}% · Evidence{" "}
              {nf(Math.round((drivers.evidenceStrength ?? 0) * 100))}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Impact" description={impact.basis} dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{impact10.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Controls" description="Signals" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(Math.round(coverage01 * 100))}%
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              actions {nf(actionsDone)}/{nf(actionsTotal)} · detections {nf(detectionsTotal)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Risk entry" description="Status, category, owner, and notes." />
        <CardContent>
          <RiskEntryEditor
            projectSlug={projectSlug}
            scenarioId={scenario.id}
            initialStatus={riskEntry?.status ?? "open"}
            initialCategory={riskEntry?.category ?? "operational"}
            initialOwner={riskEntry?.owner ?? null}
            initialNotes={riskEntry?.notes ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="FAIR-lite" description="Optional exposure estimate (LEF × loss magnitude)." />
        <CardContent>
          <RiskFairLiteEditor
            projectSlug={projectSlug}
            scenarioId={scenario.id}
            initialFairLef={riskEntry?.fairLef ?? null}
            initialFairLmLow={riskEntry?.fairLmLow ?? null}
            initialFairLmHigh={riskEntry?.fairLmHigh ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Compliance quick add" description="Link this risk to stakeholder controls." />
        <CardContent>
          <ComplianceMappingQuickAdd
            projectSlug={projectSlug}
            sources={relatedSources.map((s) => ({ kind: s.kind, id: s.id, label: s.label }))}
          />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">NIST CSF 2.0</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {nf(mappingCountsByFramework.get("nist_csf_2") ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">CIS v8</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {nf(mappingCountsByFramework.get("cis_v8") ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">ISO 27001</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {nf(mappingCountsByFramework.get("iso_27001") ?? 0)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Existing mappings" description="All mappings in this project." />
        <CardContent>
          {mappingRows.length ? (
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {mappingRows.slice(0, 50).map((m) => (
                <div key={m.id} className="py-3 grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="md:col-span-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {frameworkLabel(String(m.framework))}
                  </div>
                  <div className="md:col-span-4 text-xs text-zinc-600 dark:text-zinc-400">
                    <div className="font-medium text-zinc-700 dark:text-zinc-300">
                      {fixText(String(m.sourceKind))} · {fixText(String(m.sourceId))}
                    </div>
                  </div>
                  <div className="md:col-span-6 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{fixText(String(m.controlId))}</div>
                    {m.controlTitle ? (
                      <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 truncate">
                        {fixText(String(m.controlTitle))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No compliance mappings yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
