export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, kgEntities, kgRelations, navigatorActions, navigatorDetections, navigatorScenarios, riskEntries, riskToleranceProfiles } from "@ti/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import {
  extractNavigatorDrivers,
  impactFromCvssScore,
  impactFromPrimaryTactic,
  likelihoodFromNavigatorWhy,
  riskLevelFromScore,
  type RiskLevel,
} from "../../../../../lib/risk";
import { fixText } from "../../../../../lib/text";
import { getViewerContext } from "../../../../../lib/tenancy";

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
  if (level === "critical") return "border-red-300/70 dark:border-red-700/60 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-200";
  if (level === "high") return "border-orange-300/70 dark:border-orange-700/60 bg-orange-50/60 dark:bg-orange-950/20 text-orange-700 dark:text-orange-200";
  if (level === "medium") return "border-amber-300/70 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200";
  return "border-emerald-300/70 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-200";
}

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

function tacticLabel(tactic: string) {
  return String(tactic ?? "")
    .split("-")
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export default async function RiskRegisterPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Risk register</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Risk register is derived from Navigator scenarios and is available on Pro.
        </p>
        <a
          href={`/p/${p.projectSlug}/navigator`}
          className="mt-4 inline-block text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
        >
          Go to Navigator
        </a>
      </div>
    );
  }

  const scenarios = await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      scenarioType: navigatorScenarios.scenarioType,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      primaryTactic: navigatorScenarios.primaryTactic,
      whyJson: navigatorScenarios.whyJson,
      attributes: navigatorScenarios.attributes,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.projectId, ctx.project.id), eq(navigatorScenarios.validationStatus, "validated" as any)))
    .orderBy(desc(navigatorScenarios.computedAt))
    .limit(300);

  let riskTableMissing = false;
  const entryByScenarioId = new Map<
    string,
    { status: string; category: string; owner: string | null; updatedAt: Date | null }
  >();

  if (scenarios.length) {
    const now = new Date();
    try {
      await db
        .insert(riskEntries)
        .values(
          scenarios.map((s) => ({
            projectId: ctx.project.id,
            userId: ctx.user.id,
            scenarioId: s.id,
            status: "open" as any,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .onConflictDoNothing();

      const entryRows = await db
        .select({
          scenarioId: riskEntries.scenarioId,
          status: riskEntries.status,
          category: riskEntries.category,
          owner: riskEntries.owner,
          updatedAt: riskEntries.updatedAt,
        })
        .from(riskEntries)
        .where(and(eq(riskEntries.projectId, ctx.project.id), inArray(riskEntries.scenarioId, scenarios.map((s) => s.id))))
        .limit(700);

      for (const e of entryRows) {
        entryByScenarioId.set(e.scenarioId, {
          status: String(e.status ?? "open"),
          category: String(e.category ?? "operational"),
          owner: e.owner ?? null,
          updatedAt: e.updatedAt ?? null,
        });
      }
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") riskTableMissing = true;
      else throw err;
    }
  }

  const actionByScenarioId = new Map<string, { total: number; done: number }>();
  const detectionByScenarioId = new Map<string, number>();

  if (scenarios.length) {
    try {
      const rows = await db
        .select({
          scenarioId: navigatorActions.scenarioId,
          total: sql<number>`count(*)`,
          done: sql<number>`sum(case when ${navigatorActions.status} = 'done' then 1 else 0 end)`,
        })
        .from(navigatorActions)
        .where(and(eq(navigatorActions.projectId, ctx.project.id), inArray(navigatorActions.scenarioId, scenarios.map((s) => s.id))))
        .groupBy(navigatorActions.scenarioId)
        .limit(1500);

      for (const r of rows) {
        actionByScenarioId.set(r.scenarioId, {
          total: Number(r.total ?? 0),
          done: Number(r.done ?? 0),
        });
      }
    } catch {
      // Best-effort; if actions table is missing, treat as no coverage signals.
    }

    try {
      const rows = await db
        .select({
          scenarioId: navigatorDetections.scenarioId,
          total: sql<number>`count(*)`,
        })
        .from(navigatorDetections)
        .where(
          and(eq(navigatorDetections.projectId, ctx.project.id), inArray(navigatorDetections.scenarioId, scenarios.map((s) => s.id)))
        )
        .groupBy(navigatorDetections.scenarioId)
        .limit(1500);

      for (const r of rows) detectionByScenarioId.set(r.scenarioId, Number(r.total ?? 0));
    } catch {
      // Best-effort; navigator_detections is optional.
    }
  }

  const defaultTolerance = {
    operational: 60,
    financial: 60,
    compliance: 50,
    reputational: 50,
  };
  let tolerance = { ...defaultTolerance };
  let toleranceTableMissing = false;

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
    if (code === "42P01") toleranceTableMissing = true;
    else throw err;
  }

  const cveIds = scenarios.filter((s) => s.targetKind === "cve").map((s) => s.targetId);
  const techniqueIds = scenarios.filter((s) => s.targetKind === "technique").map((s) => s.targetId);

  const cvssByCve = new Map<string, number | null>();
  if (cveIds.length) {
    const cveRows = await db
      .select({ cveId: kgEntities.entityId, attributes: kgEntities.attributes })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, "cve"), inArray(kgEntities.entityId, Array.from(new Set(cveIds)))))
      .limit(500);

    for (const r of cveRows) {
      const attrs = coerceJson(r.attributes) ?? r.attributes;
      const score = Number((attrs as any)?.cvss?.score ?? NaN);
      cvssByCve.set(r.cveId, Number.isFinite(score) ? score : null);
    }
  }

  const mitigationCountByTechnique = new Map<string, number>();
  if (techniqueIds.length) {
    const rows = await db
      .select({
        techniqueId: kgRelations.fromId,
        count: sql<number>`count(*)`,
      })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "technique_mitigated_by"),
          eq(kgRelations.fromKind, "technique"),
          eq(kgRelations.toKind, "mitigation"),
          inArray(kgRelations.fromId, Array.from(new Set(techniqueIds)))
        )
      )
      .groupBy(kgRelations.fromId)
      .limit(1000);

    for (const r of rows) mitigationCountByTechnique.set(r.techniqueId, Number(r.count ?? 0));
  }

  const risks = scenarios
    .map((s) => {
      const likelihood01 = likelihoodFromNavigatorWhy(s.whyJson);
      const drivers = extractNavigatorDrivers(s.whyJson);

      const cvssScore = s.targetKind === "cve" ? (cvssByCve.get(s.targetId) ?? null) : null;
      const impact =
        s.targetKind === "cve" ? impactFromCvssScore(cvssScore) : impactFromPrimaryTactic(s.primaryTactic ?? null);
      const impact10 =
        s.targetKind === "cve"
          ? cvssScore ?? (Number.isFinite(impact.impact01) ? Number((impact.impact01 * 10).toFixed(1)) : null)
          : Number.isFinite(impact.impact01) ? Number((impact.impact01 * 10).toFixed(1)) : null;

      const inherent = Math.round(likelihood01 * impact.impact01 * 100);

      const actions = actionByScenarioId.get(s.id) ?? { total: 0, done: 0 };
      const detections = detectionByScenarioId.get(s.id) ?? 0;
      const actionScore = actions.done > 0 ? 1 : actions.total > 0 ? 0.5 : 0;
      const detectionScore = detections > 0 ? 1 : 0;
      const coverage01 = Math.max(0, Math.min(1, (actionScore + detectionScore) / 2));

      // Residual is a best-effort signal based on Navigator artifacts (actions + detections),
      // not verified control implementation.
      const residual = Math.max(0, Math.round(inherent * (1 - 0.4 * coverage01)));
      const level = riskLevelFromScore(inherent);

      const mitigations =
        s.targetKind === "technique" ? (mitigationCountByTechnique.get(s.targetId) ?? 0) : null;

      const attrs = (coerceJson(s.attributes) ?? s.attributes) as any;
      const kev = attrs?.kev ?? null;
      const stackMatch = attrs?.stackMatch ?? null;
      const assetHint =
        typeof stackMatch?.matchedTechnology === "string" && stackMatch.matchedTechnology.trim()
          ? stackMatch.matchedTechnology.trim()
          : typeof kev?.product === "string" && kev.product.trim()
            ? kev.product.trim()
            : typeof kev?.vendorProject === "string" && kev.vendorProject.trim()
              ? kev.vendorProject.trim()
              : null;

      const entry = entryByScenarioId.get(s.id) ?? null;
      const rawCategory = String(entry?.category ?? "operational");
      const category =
        rawCategory === "financial" || rawCategory === "compliance" || rawCategory === "reputational"
          ? rawCategory
          : "operational";
      const toleranceThreshold = Math.max(
        0,
        Math.min(100, Number((tolerance as any)[category] ?? defaultTolerance.operational))
      );
      const overTolerance = residual >= toleranceThreshold;

      return {
        id: s.id,
        title: fixText(s.title),
        scenarioType: String(s.scenarioType),
        actorName: fixText(String(s.actorName ?? s.actorId ?? "Unknown actor")),
        targetKind: String(s.targetKind ?? ""),
        targetId: String(s.targetId ?? ""),
        targetName: s.targetName ? fixText(String(s.targetName)) : null,
        primaryTactic: s.primaryTactic ? String(s.primaryTactic) : null,
        computedAt: s.computedAt,
        likelihoodPct: Math.round(likelihood01 * 100),
        drivers,
        impactBasis: impact.basis,
        impact10,
        inherent,
        residual,
        coverage01,
        actionsTotal: actions.total,
        actionsDone: actions.done,
        detectionsTotal: detections,
        level,
        mitigations,
        assetHint,
        cvssScore,
        entry,
        category,
        toleranceThreshold,
        overTolerance,
      };
    })
    .sort((a, b) => b.inherent - a.inherent || b.likelihoodPct - a.likelihoodPct || a.title.localeCompare(b.title));

  const total = risks.length;
  const maxRisk = risks.reduce((m, r) => Math.max(m, r.inherent), 0);
  const cveCount = risks.filter((r) => r.targetKind === "cve").length;
  const techniqueCount = risks.filter((r) => r.targetKind === "technique").length;
  const openCount = risks.filter((r) => String(r.entry?.status ?? "open") !== "closed").length;

  const techniqueRisks = risks.filter((r) => r.targetKind === "technique" && r.primaryTactic);
  const tacticHeat = ATTACK_TACTIC_ORDER.map((t) => {
    const items = techniqueRisks.filter((r) => r.primaryTactic === t);
    const total = items.length;
    const coveragePct = total
      ? Math.round(
          (items.reduce((acc, r) => acc + Math.max(0, Math.min(1, Number(r.coverage01 ?? 0))), 0) / total) * 100
        )
      : 0;
    const mitigatedPct = total
      ? Math.round((items.filter((r) => Number(r.mitigations ?? 0) > 0).length / total) * 100)
      : 0;
    return { tactic: t, label: tacticLabel(t), total, coveragePct, mitigatedPct };
  }).filter((r) => r.total > 0);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Risk register</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Derived from validated Navigator scenarios. Likelihood is based on actor relevance + evidence strength (and
            stack match for CVEs). Impact uses CVSS for CVEs and a tactic heuristic for techniques. Residual is a
            best-effort adjustment based on Navigator actions/detections (not verified control implementation).
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Link
            href={`/p/${p.projectSlug}/risk/settings`}
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40"
          >
            Risk settings
          </Link>
          <Link
            href={`/p/${p.projectSlug}/navigator?stage=validate`}
            className="inline-flex rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-200 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-50"
          >
            Validate scenarios
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader title="Risks" description="Validated scenarios" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Open" description="Not closed" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(openCount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Highest score" description="Inherent risk (0–100)" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(maxRisk)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="CVE / Technique" description="By scenario type" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(cveCount)} <span className="text-zinc-400 dark:text-zinc-500">/</span> {nf(techniqueCount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {riskTableMissing ? (
        <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Risk tables are missing. Run{" "}
          <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-950/30">pnpm db:migrate</code> to enable
          status/owner/notes.
        </div>
      ) : toleranceTableMissing ? (
        <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Risk tolerance profiles are missing. Run{" "}
          <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-950/30">pnpm db:migrate</code> to enable
          category-based tolerance settings (defaults are being used).
        </div>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Register"
          description={
            total
              ? `${nf(total)} validated risks. Click a row to manage the risk entry.`
              : "No validated scenarios yet. Validate a scenario in Navigator to see it here."
          }
          right={
            <a
              href={`/p/${p.projectSlug}/navigator`}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
            >
              Open Navigator
            </a>
          }
        />

        {risks.length ? (
          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
            <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <div className="col-span-2">Risk</div>
              <div className="col-span-4">Scenario</div>
              <div className="col-span-2">Actor</div>
              <div className="col-span-1 text-right">Like</div>
              <div className="col-span-1 text-right">Impact</div>
              <div className="col-span-1 text-right">Controls</div>
              <div className="col-span-1">Status</div>
            </div>
            {risks.map((r) => (
              <Link
                key={r.id}
                href={`/p/${p.projectSlug}/risk/${r.id}`}
                className="block hover:bg-zinc-50/60 dark:hover:bg-white/5"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 px-5 py-4">
                  <div className="lg:col-span-2 flex items-start justify-between lg:block">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${levelClasses(
                          r.level
                        )}`}
                      >
                        {r.level}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {nf(r.inherent)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      residual <span className="tabular-nums">{nf(r.residual)}</span>{" "}
                      <span className="text-zinc-400 dark:text-zinc-600">·</span>{" "}
                      cov <span className="tabular-nums">{nf(Math.round((r.coverage01 ?? 0) * 100))}%</span>
                    </div>
                  </div>

                  <div className="lg:col-span-4 min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {fixText(r.title)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                        {r.scenarioType}
                      </span>
                      <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                        {r.targetKind}: {r.targetId}
                      </span>
                      {r.assetHint ? (
                        <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                          asset: {fixText(r.assetHint)}
                        </span>
                      ) : null}
                      {r.cvssScore != null ? (
                        <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                          CVSS {r.cvssScore.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="lg:col-span-2 min-w-0">
                    <div className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{fixText(r.actorName)}</div>
                    {r.primaryTactic ? <div className="mt-1 text-[11px] text-zinc-500">{r.primaryTactic}</div> : null}
                  </div>

                  <div className="lg:col-span-1 text-right">
                    <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(r.likelihoodPct)}%
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">likelihood</div>
                  </div>

                  <div className="lg:col-span-1 text-right">
                    <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {r.impact10 == null ? "\u2014" : r.impact10.toFixed(1)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">{r.impactBasis}</div>
                  </div>

                  <div className="lg:col-span-1 text-right">
                    <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {r.mitigations == null ? "\u2014" : nf(r.mitigations)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">mitigations</div>
                  </div>

                  <div className="lg:col-span-1">
                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide">
                      {String(r.entry?.status ?? "open")}
                    </div>
                    <div
                      className={`mt-1 text-[11px] truncate ${r.overTolerance ? "text-red-700 dark:text-red-300" : "text-zinc-500"}`}
                    >
                      {r.category} · tol {nf(r.toleranceThreshold)}
                      {r.overTolerance ? " · over" : ""}
                    </div>
                    {r.entry?.owner ? (
                      <div className="mt-0.5 text-[11px] text-zinc-500 truncate">{fixText(r.entry.owner)}</div>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <CardContent>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No validated scenarios yet. Go to Navigator → Validate and mark scenarios as validated to populate the register.
            </p>
            <div className="mt-4">
              <Link
                href={`/p/${p.projectSlug}/navigator?stage=validate`}
                className="inline-flex rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-200 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-50"
              >
                Open Navigator → Validate
              </Link>
            </div>
          </CardContent>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Control coverage heatmap"
          description="Average coverage signal by tactic for validated technique scenarios."
        />
        <CardContent>
          {tacticHeat.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
              {tacticHeat.map((t) => {
                const pct = Math.max(0, Math.min(100, Number(t.coveragePct ?? 0)));
                const cell =
                  pct >= 70
                    ? "border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/20"
                    : pct >= 40
                      ? "border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20"
                      : "border-red-200 dark:border-red-800/70 bg-red-50/60 dark:bg-red-950/20";

                return (
                  <div key={t.tactic} className={`rounded-xl border p-3 ${cell}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
                      {t.label}
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(pct)}%
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                      mitigations {nf(t.mitigatedPct)}% · {nf(t.total)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No validated technique scenarios with tactics yet.
            </p>
          )}

          <p className="mt-4 text-xs text-zinc-500">
            Coverage is derived from Navigator artifacts (actions and detection drafts) and is not a verified control
            implementation measure. “Mitigations” is the share of techniques in that tactic with at least one MITRE
            mitigation mapped.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
