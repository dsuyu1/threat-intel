export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { agentSettings, documents, findings, getDb, kgEntities, navigatorActions, navigatorDetections, navigatorScenarios, riskEntries, riskToleranceProfiles } from "@ti/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { DualLineChart } from "../../../components/dashboard/charts";
import { KpiCard } from "../../../components/dashboard/KpiCard";
import { Card, CardContent, CardHeader } from "../../../components/ui/Card";
import { SYSTEM_AGENTS } from "../../../lib/agents";
import { toIsoStringSafe } from "../../../lib/dates";
import { hasNavigatorAccess } from "../../../lib/local-user";
import { impactFromCvssScore, impactFromPrimaryTactic, likelihoodFromNavigatorWhy } from "../../../lib/risk";
import { buildHref } from "../../../lib/search-params";
import { getViewerContext } from "../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;
type RangeId = "12m" | "6m" | "30d" | "14d";

type TrendPoint = { label: string; value: number };

type FindingRow = {
  id: string;
  title: string;
  agent: string;
  severity: string | null;
  cvssScore: string | null;
  cveId: string | null;
  publishedAt: string | null;
  createdAt: string | null;
};

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function pctChange(current: number, previous: number) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p <= 0) return c > 0 ? 100 : 0;
  return ((c - p) / p) * 100;
}

function normalizeRange(v: string | undefined): RangeId {
  const x = String(v ?? "").trim().toLowerCase();
  if (x === "12m" || x === "6m" || x === "30d" || x === "14d") return x;
  return "12m";
}

function rangeLabel(range: RangeId) {
  if (range === "12m") return "12 Months";
  if (range === "6m") return "6 Months";
  if (range === "30d") return "30 Days";
  return "14 Days";
}

function pill(value: string, kind: "agent" | "severity"): { label: string; className: string } {
  if (kind === "agent") {
    const map: Record<string, { label: string; className: string }> = {
      vuln: { label: "CVE", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20" },
      attack: { label: "Attack", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20" },
      ttp: { label: "TTP", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/20" },
      exploit: { label: "Exploit", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20" },
      malware: { label: "Malware", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
    };
    return map[value] ?? { label: value, className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" };
  }

  const smap: Record<string, { label: string; className: string }> = {
    critical: { label: "critical", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20" },
    high: { label: "high", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20" },
    medium: { label: "medium", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20" },
    low: { label: "low", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
    unscored: { label: "unscored", className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" },
    info: { label: "info", className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" },
  };
  return smap[value] ?? { label: value, className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" };
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? anyErr?.originalError?.code ?? "");
  if (code === "42P01") return true;

  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('relation "') && msg.includes("does not exist");
}

function isMissingColumn(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? anyErr?.originalError?.code ?? "");
  if (code === "42703") return true;

  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('column "') && msg.includes("does not exist");
}

function isSchemaOutOfDate(err: unknown) {
  return isMissingTable(err) || isMissingColumn(err);
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

function monthStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonthsUtc(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

async function getTrendSeries(params: { db: ReturnType<typeof getDb>; range: RangeId }) {
  const now = new Date();
  const unit: "day" | "month" = params.range.endsWith("m") ? "month" : "day";
  const count = Number(params.range.slice(0, -1));
  const bucketCount = Number.isFinite(count) && count > 0 ? count : 12;

  if (unit === "month") {
    const end = monthStartUtc(now);
    const currentStart = addMonthsUtc(end, -(bucketCount - 1));
    const previousStart = addMonthsUtc(currentStart, -bucketCount);

    const monthExpr = sql<string | Date>`date_trunc('month', ${findings.publishedAt})`;
    const rows = await params.db
      .select({ bucket: monthExpr, count: sql<number>`count(*)` })
      .from(findings)
      .where(and(isNotNull(findings.publishedAt), gte(findings.publishedAt, previousStart)))
      .groupBy(monthExpr)
      .orderBy(monthExpr)
      .limit(240);

    const byKey = new Map<string, number>();
    for (const r of rows) {
      const iso = toIsoStringSafe(r.bucket);
      if (!iso) continue;
      byKey.set(iso.slice(0, 7), Number(r.count ?? 0));
    }

    const current: TrendPoint[] = [];
    const previous: TrendPoint[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const prevMonth = addMonthsUtc(previousStart, i);
      const curMonth = addMonthsUtc(currentStart, i);
      const label = curMonth.toLocaleString("en-US", { month: "short" });
      previous.push({ label, value: byKey.get(prevMonth.toISOString().slice(0, 7)) ?? 0 });
      current.push({ label, value: byKey.get(curMonth.toISOString().slice(0, 7)) ?? 0 });
    }

    return { current, previous };
  }

  const msDay = 86_400_000;
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const currentStart = new Date(end.getTime() - (bucketCount - 1) * msDay);
  const previousStart = new Date(currentStart.getTime() - bucketCount * msDay);

  const dayExpr = sql<string | Date>`date_trunc('day', ${findings.publishedAt})`;
  const rows = await params.db
    .select({ bucket: dayExpr, count: sql<number>`count(*)` })
    .from(findings)
    .where(and(isNotNull(findings.publishedAt), gte(findings.publishedAt, previousStart)))
    .groupBy(dayExpr)
    .orderBy(dayExpr)
    .limit(500);

  const byKey = new Map<string, number>();
  for (const r of rows) {
    const iso = toIsoStringSafe(r.bucket);
    if (!iso) continue;
    byKey.set(iso.slice(0, 10), Number(r.count ?? 0));
  }

  const current: TrendPoint[] = [];
  const previous: TrendPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const prevDay = new Date(previousStart.getTime() + i * msDay);
    const curDay = new Date(currentStart.getTime() + i * msDay);
    const label = curDay.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    previous.push({ label, value: byKey.get(prevDay.toISOString().slice(0, 10)) ?? 0 });
    current.push({ label, value: byKey.get(curDay.toISOString().slice(0, 10)) ?? 0 });
  }

  return { current, previous };
}

async function getDashboardData(params: { range: RangeId; projectId: string; userId: string; riskAccess: boolean }) {
  const db = getDb();

  const [{ totalFindings }] = await db.select({ totalFindings: sql<number>`count(*)` }).from(findings);
  const [{ totalDocs }] = await db.select({ totalDocs: sql<number>`count(*)` }).from(documents);

  const [{ lastIngestedAt }] = await db.select({ lastIngestedAt: sql<Date | null>`max(${findings.createdAt})` }).from(findings);

  const trend = await getTrendSeries({ db, range: params.range });

  const trendCurrentTotal = trend.current.reduce((acc, d) => acc + d.value, 0);
  const trendPrevTotal = trend.previous.reduce((acc, d) => acc + d.value, 0);

  const latestFindings = await db
    .select({
      id: findings.id,
      title: findings.title,
      agent: findings.agent,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cveId: findings.cveId,
      publishedAt: findings.publishedAt,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .orderBy(desc(findings.publishedAt), desc(findings.createdAt), desc(findings.id))
    .limit(6);

  let enabledAgents = SYSTEM_AGENTS.length;
  let totalAgents = SYSTEM_AGENTS.length;
  let agentsSchemaReady = true;
  try {
    const agentSettingRows = await db
      .select({ agentKey: agentSettings.agentKey, enabled: agentSettings.enabled })
      .from(agentSettings);
    const disabledAgents = new Set(agentSettingRows.filter((r) => r.enabled === false).map((r) => r.agentKey));
    enabledAgents = SYSTEM_AGENTS.filter((a) => !disabledAgents.has(a.key)).length;
  } catch (err) {
    if (isMissingTable(err)) agentsSchemaReady = false;
    else throw err;
  }

  let totalEntities = 0;
  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(kgEntities);
    totalEntities = Number(total ?? 0);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const trendChange = pctChange(trendCurrentTotal, trendPrevTotal);

  const attention = {
    unvalidatedScenarios: null as number | null,
  };

  if (params.riskAccess) {
    try {
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(navigatorScenarios)
        .where(
          and(
            eq(navigatorScenarios.projectId, params.projectId),
            inArray(navigatorScenarios.validationStatus, ["unvalidated" as any, "in_progress" as any])
          )
        );
      attention.unvalidatedScenarios = Number(total ?? 0);
    } catch (err) {
      if (!isSchemaOutOfDate(err)) throw err;
    }
  }

  let riskSchemaReady = true;
  let risk:
    | null
    | {
        openCount: number;
        overToleranceCount: number;
        openResidual: number;
        trend: { current: TrendPoint[]; previous: TrendPoint[]; changePct: number | null };
      } = null;

  if (params.riskAccess) {
    try {
      const days = 14;
      const msDay = 86_400_000;
      const now = new Date();
      const end = new Date(now);
      end.setUTCHours(0, 0, 0, 0);
      const endExclusive = new Date(end.getTime() + msDay);
      const currentStart = new Date(end.getTime() - (days - 1) * msDay);
      const previousStart = new Date(currentStart.getTime() - days * msDay);

      const defaults = { operational: 60, financial: 60, compliance: 50, reputational: 50 };
      let tolerance = { ...defaults };
      try {
        const [row] = await db
          .select({
            operational: riskToleranceProfiles.operationalThreshold,
            financial: riskToleranceProfiles.financialThreshold,
            compliance: riskToleranceProfiles.complianceThreshold,
            reputational: riskToleranceProfiles.reputationalThreshold,
          })
          .from(riskToleranceProfiles)
          .where(eq(riskToleranceProfiles.projectId, params.projectId))
          .limit(1);

        if (row) {
          tolerance = {
            operational: Number(row.operational ?? defaults.operational),
            financial: Number(row.financial ?? defaults.financial),
            compliance: Number(row.compliance ?? defaults.compliance),
            reputational: Number(row.reputational ?? defaults.reputational),
          };
        }
      } catch (err) {
        if (!isMissingTable(err)) throw err;
      }

      // Best-effort backfill: create risk entries for any validated scenarios.
      const validatedScenarios = await db
        .select({ id: navigatorScenarios.id })
        .from(navigatorScenarios)
        .where(and(eq(navigatorScenarios.projectId, params.projectId), eq(navigatorScenarios.validationStatus, "validated" as any)))
        .limit(1200);

      if (validatedScenarios.length) {
        const now2 = new Date();
        await db
          .insert(riskEntries)
          .values(
            validatedScenarios.map((s) => ({
              projectId: params.projectId,
              userId: params.userId,
              scenarioId: s.id,
              status: "open" as any,
              createdAt: now2,
              updatedAt: now2,
            }))
          )
          .onConflictDoNothing();
      }

      const closedAtEffective = sql<Date | null>`coalesce(${riskEntries.closedAt}, case when ${riskEntries.status} = 'closed' then ${riskEntries.updatedAt} else null end)`;

      const entryRows = await db
        .select({
          scenarioId: riskEntries.scenarioId,
          status: riskEntries.status,
          category: riskEntries.category,
          createdAt: riskEntries.createdAt,
          updatedAt: riskEntries.updatedAt,
          closedAt: riskEntries.closedAt,
          targetKind: navigatorScenarios.targetKind,
          targetId: navigatorScenarios.targetId,
          primaryTactic: navigatorScenarios.primaryTactic,
          whyJson: navigatorScenarios.whyJson,
        })
        .from(riskEntries)
        .innerJoin(
          navigatorScenarios,
          and(eq(navigatorScenarios.id, riskEntries.scenarioId), eq(navigatorScenarios.projectId, riskEntries.projectId))
        )
        .where(
          and(
            eq(riskEntries.projectId, params.projectId),
            sql`${riskEntries.createdAt} < ${endExclusive}`,
            sql`(${closedAtEffective} is null or ${closedAtEffective} >= ${previousStart})`
          )
        )
        .limit(2000);

      const scenarioIds = Array.from(new Set(entryRows.map((r) => r.scenarioId)));

      const cvssByCve = new Map<string, number | null>();
      const cveIds = Array.from(new Set(entryRows.filter((r) => r.targetKind === "cve").map((r) => String(r.targetId))));
      if (cveIds.length) {
        const cveRows = await db
          .select({ cveId: kgEntities.entityId, attributes: kgEntities.attributes })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "cve"), inArray(kgEntities.entityId, cveIds)))
          .limit(2000);

        for (const r of cveRows) {
          const attrs = coerceJson(r.attributes) ?? r.attributes;
          const score = Number((attrs as any)?.cvss?.score ?? NaN);
          cvssByCve.set(r.cveId, Number.isFinite(score) ? score : null);
        }
      }

      const actionByScenarioId = new Map<string, { total: number; done: number }>();
      if (scenarioIds.length) {
        try {
          const rows = await db
            .select({
              scenarioId: navigatorActions.scenarioId,
              total: sql<number>`count(*)`,
              done: sql<number>`sum(case when ${navigatorActions.status} = 'done' then 1 else 0 end)`,
            })
            .from(navigatorActions)
            .where(and(eq(navigatorActions.projectId, params.projectId), inArray(navigatorActions.scenarioId, scenarioIds)))
            .groupBy(navigatorActions.scenarioId)
            .limit(2000);

          for (const r of rows) {
            actionByScenarioId.set(r.scenarioId, { total: Number(r.total ?? 0), done: Number(r.done ?? 0) });
          }
        } catch {
          // Best-effort.
        }
      }

      const detectionByScenarioId = new Map<string, number>();
      if (scenarioIds.length) {
        try {
            const rows = await db
              .select({ scenarioId: navigatorDetections.scenarioId, total: sql<number>`count(*)` })
              .from(navigatorDetections)
              .where(and(eq(navigatorDetections.projectId, params.projectId), inArray(navigatorDetections.scenarioId, scenarioIds)))
              .groupBy(navigatorDetections.scenarioId)
              .limit(2000);

          for (const r of rows) detectionByScenarioId.set(r.scenarioId, Number(r.total ?? 0));
        } catch {
          // navigator_detections is optional.
        }
      }

      const computed = entryRows.map((r) => {
        const likelihood01 = likelihoodFromNavigatorWhy(r.whyJson);
        const cvssScore = r.targetKind === "cve" ? (cvssByCve.get(String(r.targetId)) ?? null) : null;
        const impact = r.targetKind === "cve" ? impactFromCvssScore(cvssScore) : impactFromPrimaryTactic(r.primaryTactic ?? null);
        const inherent = Math.round(likelihood01 * impact.impact01 * 100);

        const actions = actionByScenarioId.get(r.scenarioId) ?? { total: 0, done: 0 };
        const detections = detectionByScenarioId.get(r.scenarioId) ?? 0;
        const actionScore = actions.done > 0 ? 1 : actions.total > 0 ? 0.5 : 0;
        const detectionScore = detections > 0 ? 1 : 0;
        const coverage01 = Math.max(0, Math.min(1, (actionScore + detectionScore) / 2));
        const residual = Math.max(0, Math.round(inherent * (1 - 0.4 * coverage01)));

        const rawCategory = String(r.category ?? "operational");
        const category = rawCategory === "financial" || rawCategory === "compliance" || rawCategory === "reputational" ? rawCategory : "operational";
        const threshold = Math.max(0, Math.min(100, Number((tolerance as any)[category] ?? defaults.operational)));
        const overTolerance = residual >= threshold;

        const closedAt = r.closedAt ?? (String(r.status) === "closed" ? r.updatedAt : null);

        return {
          createdAt: r.createdAt,
          closedAt,
          status: String(r.status ?? "open"),
          residual,
          overTolerance,
        };
      });

      const seriesFor = (start: Date) => {
        const out: TrendPoint[] = [];
        for (let i = 0; i < days; i++) {
          const dayStart = new Date(start.getTime() + i * msDay);
          const dayEnd = new Date(dayStart.getTime() + msDay);
          const value = computed.reduce((acc, e) => {
            if (e.createdAt && e.createdAt >= dayEnd) return acc;
            if (e.closedAt && e.closedAt < dayEnd) return acc;
            return acc + e.residual;
          }, 0);
          out.push({ label: dayStart.toLocaleDateString("en-US", { month: "short", day: "2-digit" }), value });
        }
        return out;
      };

      const current = seriesFor(currentStart);
      const previous = seriesFor(previousStart);
      const changePct = pctChange(current[current.length - 1]?.value ?? 0, previous[previous.length - 1]?.value ?? 0);

      const nowOpen = computed.filter((e) => e.closedAt == null && e.status !== "closed");
      const openResidual = nowOpen.reduce((acc, e) => acc + e.residual, 0);
      const overToleranceCount = nowOpen.filter((e) => e.overTolerance).length;

      risk = {
        openCount: nowOpen.length,
        overToleranceCount,
        openResidual,
        trend: { current, previous, changePct },
      };
    } catch (err) {
      if (!isSchemaOutOfDate(err)) throw err;
      riskSchemaReady = false;
      risk = null;
    }
  }

  return {
    range: params.range,
    rangeLabel: rangeLabel(params.range),
    attention,
    kpis: {
      totalFindings: Number(totalFindings ?? 0),
      totalDocs: Number(totalDocs ?? 0),
      enabledAgents,
      totalAgents,
      agentsSchemaReady,
      lastIngestedAt: toIsoStringSafe(lastIngestedAt),
      totalEntities,
    },
    trend: {
      current: trend.current,
      previous: trend.previous,
      changePct: trendChange,
    },
    riskSchemaReady,
    latestFindings: latestFindings.map((f): FindingRow => ({
      id: f.id,
      title: f.title,
      agent: String(f.agent),
      severity: f.severity ? String(f.severity) : null,
      cvssScore: f.cvssScore != null ? String(f.cvssScore) : null,
      cveId: f.cveId ?? null,
      publishedAt: toIsoStringSafe(f.publishedAt),
      createdAt: toIsoStringSafe(f.createdAt),
    })),
    risk,
  };
}

export default async function DashboardHome({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const range = normalizeRange(pickOne(sp.range));

  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const riskAccess = hasNavigatorAccess({ tier: ctx.user.tier });
  const data = await getDashboardData({ range, projectId: ctx.project.id, userId: ctx.user.id, riskAccess });
  const currentHref = { range: data.range };

  const ingestionHint = (() => {
    if (!data.kpis.agentsSchemaReady) return "Run pnpm db:migrate";
    if (!data.kpis.lastIngestedAt) return "Healthy";
    const d = new Date(data.kpis.lastIngestedAt);
    if (Number.isNaN(d.getTime())) return "Healthy";
    return `Last ingest: ${d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  })();

  const tabs: Array<{ id: RangeId; label: string }> = [
    { id: "12m", label: "12 Months" },
    { id: "6m", label: "6 Months" },
    { id: "30d", label: "30 Days" },
    { id: "14d", label: "14 Days" },
  ];

  return (
    <div className="h-full min-h-0 mx-auto max-w-[1440px] px-8 py-8">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">Dashboard</div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Current exposure
          </h1>
        </div>

        <form action="/findings" method="get" className="lg:ml-auto w-full lg:w-[560px]">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true">
              ⌕
            </span>
            <input
              name="q"
              placeholder="Type to search findings"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/30 px-10 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
        </form>
      </div>

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Findings"
          value={nf(data.kpis.totalFindings)}
          hint="Total stored"
          href="/data/findings"
        />
        <KpiCard
          label="Docs ingested"
          value={nf(data.kpis.totalDocs)}
          hint="Fetched + parsed"
          href="/data/documents"
        />
        <KpiCard
          label="Agents enabled"
          value={`${nf(data.kpis.enabledAgents)} / ${nf(data.kpis.totalAgents)}`}
          hint={ingestionHint}
          href="/agents"
        />
        <KpiCard
          label="Knowledge graph"
          value={nf(data.kpis.totalEntities)}
          hint="Entities stored"
          href="/data/kg_entities"
        />
      </section>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-3 shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Findings report"
            description={`${data.rangeLabel} published volume (current vs previous period).`}
            border={false}
            right={
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-1">
                  {tabs.map((t) => {
                    const active = t.id === data.range;
                    return (
                      <a
                        key={t.id}
                        href={buildHref(`/p/${p.projectSlug}`, currentHref, { range: t.id })}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          active
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        {t.label}
                      </a>
                    );
                  })}
                </div>
                <a
                  href="/findings"
                  className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                >
                  Open feed
                </a>
              </div>
            }
          />
          <CardContent className="pt-2">
            <DualLineChart primary={data.trend.current} secondary={data.trend.previous} height={260} />
            {typeof data.trend.changePct === "number" ? (
              <div className="mt-2 text-[11px] text-zinc-500">
                Period change: <span className="tabular-nums">{Math.round(data.trend.changePct)}%</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-sm dark:shadow-black/30">
           <CardHeader
             title="Risk trend"
             description="Open residual exposure (last 14 days)."
             border={false}
             right={
              <a href={`/p/${p.projectSlug}/risk`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                Open
              </a>
             }
           />
          <CardContent className="pt-2">
            {!riskAccess ? (
              <div className="py-4 text-sm text-zinc-500">Risk management is available on Pro.</div>
            ) : !data.riskSchemaReady ? (
              <div className="py-4 text-sm text-zinc-500">
                Risk tables need a DB migration. Run <span className="font-mono">pnpm db:migrate</span>.
              </div>
            ) : data.risk ? (
              <div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] text-zinc-500">Open residual</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(data.risk.openResidual)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-zinc-500">Open / over tol</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(data.risk.openCount)} / {nf(data.risk.overToleranceCount)}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <DualLineChart primary={data.risk.trend.current} secondary={data.risk.trend.previous} height={170} />
                </div>
                {typeof data.risk.trend.changePct === "number" ? (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    Period change: <span className="tabular-nums">{Math.round(data.risk.trend.changePct)}%</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="py-4 text-sm text-zinc-500">
                Validate a Navigator scenario to start tracking risk.
              </div>
            )}
          </CardContent>
        </Card>

      </section>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Latest findings"
            description="Most recent items across all agents."
            border={false}
            right={
              <a href="/findings" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                See all
              </a>
            }
          />
          <CardContent className="pt-2">
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {data.latestFindings.length ? (
                data.latestFindings.map((f) => {
                  const agentMeta = pill(f.agent, "agent");
                  const severityKey = (() => {
                    if (f.severity) return String(f.severity);
                    const n = Number(f.cvssScore);
                    if (!Number.isFinite(n)) return "unscored";
                    if (n >= 9) return "critical";
                    if (n >= 7) return "high";
                    if (n >= 4) return "medium";
                    return "low";
                  })();
                  const severityMeta = pill(severityKey, "severity");
                  const when = f.publishedAt ?? f.createdAt;
                  return (
                    <Link
                      key={f.id}
                      href={`/findings/${f.id}`}
                      className="block py-3 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="shrink-0 mt-0.5 flex flex-col gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${severityMeta.className}`}>
                            {severityMeta.label}
                          </span>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${agentMeta.className}`}>
                            {agentMeta.label}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{f.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                            {f.cveId ? <span className="tabular-nums">{f.cveId}</span> : null}
                            {when ? (
                              <span className="tabular-nums">
                                {new Date(when).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="py-4 text-sm text-zinc-500">No findings yet.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm dark:shadow-black/30">
         <CardHeader
           title="Needs attention"
           description="What to triage right now."
           border={false}
           right={
              <a href={`/p/${p.projectSlug}/risk`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                Open
              </a>
           }
         />
          <CardContent className="pt-2">
            <div className="space-y-2">
              <a
                href="/data/findings"
                className="flex items-center justify-between gap-4 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Findings</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">All findings stored in the platform.</div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {nf(data.kpis.totalFindings)}
                </div>
              </a>

              <a
                href="/data/documents"
                className="flex items-center justify-between gap-4 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Docs ingested</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">All fetched + parsed documents.</div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {nf(data.kpis.totalDocs)}
                </div>
              </a>

              <a
                href={`/p/${p.projectSlug}/navigator?stage=validate`}
                className="flex items-center justify-between gap-4 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Navigator scenarios</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">Unvalidated / in progress.</div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {!riskAccess ? "Pro" : nf(data.attention.unvalidatedScenarios ?? 0)}
                </div>
              </a>

              <a
                href={`/p/${p.projectSlug}/risk`}
                className="flex items-center justify-between gap-4 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Over tolerance</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">Open risks above your thresholds.</div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {!riskAccess ? "Pro" : !data.riskSchemaReady ? "—" : nf(data.risk?.overToleranceCount ?? 0)}
                </div>
              </a>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
