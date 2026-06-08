export const runtime = "edge";
export const dynamic = "force-dynamic";

import { agentRuns, agentSettings, documents, findings, getDb, incidents, kgEntities, navigatorActions, navigatorDetections, navigatorScenarios, playbookIncidentReviewSteps, playbookIncidentReviewToolActions, playbookIncidentReviews, riskEntries, riskToleranceProfiles, sources } from "@ti/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { CustomizableDashboard } from "../../../../components/dashboard/CustomizableDashboard";
import { KpiCard } from "../../../../components/dashboard/KpiCard";
import { SYSTEM_AGENTS } from "../../../../lib/agents";
import { toIsoStringSafe } from "../../../../lib/dates";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { impactFromCvssScore, impactFromPrimaryTactic, likelihoodFromNavigatorWhy } from "../../../../lib/risk";
import { buildHref } from "../../../../lib/search-params";
import { getViewerContext } from "../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;
type RangeId = "12m" | "6m" | "30d" | "14d";

type TrendPoint = { label: string; value: number };

type IncidentTypeBreakdownRow = {
  incidentType: string;
  count: number;
  meanMinutes: number;
};

type MetricSeries = {
  current: TrendPoint[];
  previous: TrendPoint[];
  changePct: number | null;
  meanMinutes: number | null;
  byType: IncidentTypeBreakdownRow[];
};

type PlaybookEffectiveness = {
  avgScore: number | null;
  reviewCount: number;
  topSkippedSteps: Array<{ label: string; count: number }>;
  topFailedActions: Array<{ label: string; count: number }>;
};

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
  // Percent deltas are not meaningful without a non-zero baseline.
  if (p <= 0) return null;
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

function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rangeBounds(range: RangeId) {
  const now = new Date();
  const unit: "day" | "month" = range.endsWith("m") ? "month" : "day";
  const count = Number(range.slice(0, -1));
  const bucketCount = Number.isFinite(count) && count > 0 ? count : 12;

  if (unit === "month") {
    const end = monthStartUtc(now);
    const currentStart = addMonthsUtc(end, -(bucketCount - 1));
    const previousStart = addMonthsUtc(currentStart, -bucketCount);
    return { unit, bucketCount, currentStart, previousStart, endExclusive: now };
  }

  const msDay = 86_400_000;
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const currentStart = new Date(end.getTime() - (bucketCount - 1) * msDay);
  const previousStart = new Date(currentStart.getTime() - bucketCount * msDay);
  return { unit, bucketCount, currentStart, previousStart, endExclusive: now };
}

async function getIncidentMetrics(params: { db: ReturnType<typeof getDb>; range: RangeId; projectId: string }) {
  const bounds = rangeBounds(params.range);

  const empty: MetricSeries = { current: [], previous: [], changePct: null, meanMinutes: null, byType: [] };
  let schemaReady = true;

  const mttdMinutes = sql<number>`greatest(0, extract(epoch from (${incidents.detectedAt} - ${incidents.startedAt})) / 60.0)`;
  const mttrMinutes = sql<number>`greatest(0, extract(epoch from (${incidents.respondedAt} - ${incidents.detectedAt})) / 60.0)`;
  const mtcMinutes = sql<number>`greatest(0, extract(epoch from (${incidents.containedAt} - ${incidents.detectedAt})) / 60.0)`;

  try {
    const bucketExpr =
      bounds.unit === "month"
        ? sql<string | Date>`date_trunc('month', ${incidents.detectedAt})`
        : sql<string | Date>`date_trunc('day', ${incidents.detectedAt})`;

    const bucketLimit = bounds.unit === "month" ? 240 : 500;

    const bucketRows = await params.db
      .select({
        bucket: bucketExpr,
        mttd: sql<number | null>`avg(${mttdMinutes})`,
        mttr: sql<number | null>`avg(${mttrMinutes})`,
        mtc: sql<number | null>`avg(${mtcMinutes})`,
      })
      .from(incidents)
      .where(
        and(eq(incidents.projectId, params.projectId), isNotNull(incidents.detectedAt), gte(incidents.detectedAt, bounds.previousStart))
      )
      .groupBy(bucketExpr)
      .orderBy(bucketExpr)
      .limit(bucketLimit);

    const mttdByKey = new Map<string, number>();
    const mttrByKey = new Map<string, number>();
    const mtcByKey = new Map<string, number>();

    const slice = bounds.unit === "month" ? 7 : 10;
    for (const r of bucketRows) {
      const iso = toIsoStringSafe(r.bucket);
      if (!iso) continue;
      const key = iso.slice(0, slice);
      const mttd = parseNum(r.mttd);
      const mttr = parseNum(r.mttr);
      const mtc = parseNum(r.mtc);
      if (mttd != null) mttdByKey.set(key, mttd);
      if (mttr != null) mttrByKey.set(key, mttr);
      if (mtc != null) mtcByKey.set(key, mtc);
    }

    const mttdCurrent: TrendPoint[] = [];
    const mttdPrevious: TrendPoint[] = [];
    const mttrCurrent: TrendPoint[] = [];
    const mttrPrevious: TrendPoint[] = [];
    const mtcCurrent: TrendPoint[] = [];
    const mtcPrevious: TrendPoint[] = [];

    if (bounds.unit === "month") {
      for (let i = 0; i < bounds.bucketCount; i++) {
        const prevMonth = addMonthsUtc(bounds.previousStart, i);
        const curMonth = addMonthsUtc(bounds.currentStart, i);
        const label = curMonth.toLocaleString("en-US", { month: "short" });
        const prevKey = prevMonth.toISOString().slice(0, 7);
        const curKey = curMonth.toISOString().slice(0, 7);

        mttdPrevious.push({ label, value: mttdByKey.get(prevKey) ?? 0 });
        mttdCurrent.push({ label, value: mttdByKey.get(curKey) ?? 0 });
        mttrPrevious.push({ label, value: mttrByKey.get(prevKey) ?? 0 });
        mttrCurrent.push({ label, value: mttrByKey.get(curKey) ?? 0 });
        mtcPrevious.push({ label, value: mtcByKey.get(prevKey) ?? 0 });
        mtcCurrent.push({ label, value: mtcByKey.get(curKey) ?? 0 });
      }
    } else {
      const msDay = 86_400_000;
      for (let i = 0; i < bounds.bucketCount; i++) {
        const prevDay = new Date(bounds.previousStart.getTime() + i * msDay);
        const curDay = new Date(bounds.currentStart.getTime() + i * msDay);
        const label = curDay.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
        const prevKey = prevDay.toISOString().slice(0, 10);
        const curKey = curDay.toISOString().slice(0, 10);

        mttdPrevious.push({ label, value: mttdByKey.get(prevKey) ?? 0 });
        mttdCurrent.push({ label, value: mttdByKey.get(curKey) ?? 0 });
        mttrPrevious.push({ label, value: mttrByKey.get(prevKey) ?? 0 });
        mttrCurrent.push({ label, value: mttrByKey.get(curKey) ?? 0 });
        mtcPrevious.push({ label, value: mtcByKey.get(prevKey) ?? 0 });
        mtcCurrent.push({ label, value: mtcByKey.get(curKey) ?? 0 });
      }
    }

    const [currentMeans] = await params.db
      .select({
        mttd: sql<number | null>`avg(${mttdMinutes})`,
        mttr: sql<number | null>`avg(${mttrMinutes})`,
        mtc: sql<number | null>`avg(${mtcMinutes})`,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, params.projectId),
          isNotNull(incidents.detectedAt),
          gte(incidents.detectedAt, bounds.currentStart),
          lt(incidents.detectedAt, bounds.endExclusive)
        )
      );

    const [previousMeans] = await params.db
      .select({
        mttd: sql<number | null>`avg(${mttdMinutes})`,
        mttr: sql<number | null>`avg(${mttrMinutes})`,
        mtc: sql<number | null>`avg(${mtcMinutes})`,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, params.projectId),
          isNotNull(incidents.detectedAt),
          gte(incidents.detectedAt, bounds.previousStart),
          lt(incidents.detectedAt, bounds.currentStart)
        )
      );

    const byTypeRows = await params.db
      .select({
        incidentType: incidents.incidentType,
        incidentCount: sql<number>`count(*)`,
        mttdCount: sql<number>`sum(case when ${incidents.startedAt} is not null and ${incidents.detectedAt} is not null then 1 else 0 end)`,
        mttdMean: sql<number | null>`avg(${mttdMinutes})`,
        mttrCount: sql<number>`sum(case when ${incidents.respondedAt} is not null and ${incidents.detectedAt} is not null then 1 else 0 end)`,
        mttrMean: sql<number | null>`avg(${mttrMinutes})`,
        mtcCount: sql<number>`sum(case when ${incidents.containedAt} is not null and ${incidents.detectedAt} is not null then 1 else 0 end)`,
        mtcMean: sql<number | null>`avg(${mtcMinutes})`,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, params.projectId),
          isNotNull(incidents.detectedAt),
          gte(incidents.detectedAt, bounds.currentStart),
          lt(incidents.detectedAt, bounds.endExclusive)
        )
      )
      .groupBy(incidents.incidentType)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(10);

    const toBreakdown = (rows: typeof byTypeRows, which: "mttd" | "mttr" | "mtc") => {
      const out: IncidentTypeBreakdownRow[] = [];
      for (const r of rows) {
        const incidentType = String(r.incidentType ?? "");
        const count = Number(
          which === "mttd" ? r.mttdCount ?? 0 : which === "mttr" ? r.mttrCount ?? 0 : r.mtcCount ?? 0
        );
        const meanRaw = which === "mttd" ? r.mttdMean : which === "mttr" ? r.mttrMean : r.mtcMean;
        const meanMinutes = parseNum(meanRaw);
        if (!count || meanMinutes == null) continue;
        out.push({ incidentType, count, meanMinutes });
      }
      out.sort((a, b) => b.count - a.count);
      return out.slice(0, 6);
    };

    const currentMttd = parseNum(currentMeans?.mttd);
    const prevMttd = parseNum(previousMeans?.mttd);
    const currentMttr = parseNum(currentMeans?.mttr);
    const prevMttr = parseNum(previousMeans?.mttr);
    const currentMtc = parseNum(currentMeans?.mtc);
    const prevMtc = parseNum(previousMeans?.mtc);

    const mttd: MetricSeries = {
      current: mttdCurrent,
      previous: mttdPrevious,
      meanMinutes: currentMttd,
      changePct: currentMttd != null && prevMttd != null ? pctChange(currentMttd, prevMttd) : null,
      byType: toBreakdown(byTypeRows, "mttd"),
    };

    const mttr: MetricSeries = {
      current: mttrCurrent,
      previous: mttrPrevious,
      meanMinutes: currentMttr,
      changePct: currentMttr != null && prevMttr != null ? pctChange(currentMttr, prevMttr) : null,
      byType: toBreakdown(byTypeRows, "mttr"),
    };

    const mtc: MetricSeries = {
      current: mtcCurrent,
      previous: mtcPrevious,
      meanMinutes: currentMtc,
      changePct: currentMtc != null && prevMtc != null ? pctChange(currentMtc, prevMtc) : null,
      byType: toBreakdown(byTypeRows, "mtc"),
    };

    return { schemaReady, metrics: { mttd, mttr, mtc }, bounds };
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    schemaReady = false;
    return { schemaReady, metrics: { mttd: empty, mttr: empty, mtc: empty }, bounds };
  }
}

async function getPlaybookEffectiveness(params: { db: ReturnType<typeof getDb>; range: RangeId; projectId: string }) {
  const bounds = rangeBounds(params.range);

  try {
    const [agg] = await params.db
      .select({
        reviewCount: sql<number>`count(*)`,
        avgScore: sql<number | null>`avg(${playbookIncidentReviews.effectivenessScore})`,
      })
      .from(playbookIncidentReviews)
      .where(
        and(
          eq(playbookIncidentReviews.projectId, params.projectId),
          gte(playbookIncidentReviews.createdAt, bounds.currentStart),
          lt(playbookIncidentReviews.createdAt, bounds.endExclusive)
        )
      );

    const skipped = await params.db
      .select({
        stepTitle: playbookIncidentReviewSteps.stepTitle,
        total: sql<number>`count(*)`,
      })
      .from(playbookIncidentReviewSteps)
      .innerJoin(playbookIncidentReviews, eq(playbookIncidentReviews.id, playbookIncidentReviewSteps.reviewId))
      .where(
        and(
          eq(playbookIncidentReviews.projectId, params.projectId),
          eq(playbookIncidentReviewSteps.status, "skipped"),
          gte(playbookIncidentReviews.createdAt, bounds.currentStart),
          lt(playbookIncidentReviews.createdAt, bounds.endExclusive)
        )
      )
      .groupBy(playbookIncidentReviewSteps.stepTitle)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(5);

    const failed = await params.db
      .select({
        tool: playbookIncidentReviewToolActions.tool,
        label: playbookIncidentReviewToolActions.label,
        total: sql<number>`count(*)`,
      })
      .from(playbookIncidentReviewToolActions)
      .innerJoin(playbookIncidentReviews, eq(playbookIncidentReviews.id, playbookIncidentReviewToolActions.reviewId))
      .where(
        and(
          eq(playbookIncidentReviews.projectId, params.projectId),
          eq(playbookIncidentReviewToolActions.status, "failed"),
          gte(playbookIncidentReviews.createdAt, bounds.currentStart),
          lt(playbookIncidentReviews.createdAt, bounds.endExclusive)
        )
      )
      .groupBy(playbookIncidentReviewToolActions.tool, playbookIncidentReviewToolActions.label)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(5);

    const effectiveness: PlaybookEffectiveness = {
      reviewCount: Number(agg?.reviewCount ?? 0),
      avgScore: parseNum(agg?.avgScore),
      topSkippedSteps: skipped.map((r) => ({ label: String(r.stepTitle ?? "").trim() || "Untitled step", count: Number(r.total ?? 0) })),
      topFailedActions: failed.map((r) => ({
        label: `${String(r.tool ?? "").trim() || "tool"}: ${String(r.label ?? "").trim() || "action"}`,
        count: Number(r.total ?? 0),
      })),
    };

    return effectiveness;
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    return null;
  }
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
  const bounds = rangeBounds(params.range);

  const [{ totalFindings }] = await db.select({ totalFindings: sql<number>`count(*)` }).from(findings);
  const [{ totalDocs }] = await db.select({ totalDocs: sql<number>`count(*)` }).from(documents);

  const [{ lastIngestedAt }] = await db.select({ lastIngestedAt: sql<Date | null>`max(${findings.createdAt})` }).from(findings);

  const ops = {
    sources: {
      schemaReady: true,
      total: 0,
      enabled: 0,
      staleEnabled: 0,
      lastFetchedAt: null as string | null,
      all: [] as Array<{ id: string; name: string; url: string; type: string; enabled: boolean }>,
    },
    agentRuns: {
      schemaReady: true,
      failed24h: 0,
      lastRun: null as null | { agentKey: string; status: string; finishedAt: string | null },
    },
  };

  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(sources);
    const [{ enabled }] = await db
      .select({ enabled: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.enabled, true));

    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [{ stale }] = await db
      .select({ stale: sql<number>`count(*)` })
      .from(sources)
      .where(and(eq(sources.enabled, true), or(isNull(sources.lastFetchedAt), lt(sources.lastFetchedAt, staleCutoff))));

    const [{ lastFetchedAt }] = await db
      .select({ lastFetchedAt: sql<Date | null>`max(${sources.lastFetchedAt})` })
      .from(sources)
      .where(eq(sources.enabled, true));

    const all = await db
      .select({
        id: sources.id,
        name: sources.name,
        url: sources.url,
        type: sources.type,
        enabled: sources.enabled,
      })
      .from(sources)
      .orderBy(desc(sources.enabled), asc(sources.name));

    ops.sources.total = Number(total ?? 0);
    ops.sources.enabled = Number(enabled ?? 0);
    ops.sources.staleEnabled = Number(stale ?? 0);
    ops.sources.lastFetchedAt = toIsoStringSafe(lastFetchedAt);
    ops.sources.all = all.map((s) => ({
      id: s.id,
      name: String(s.name),
      url: String(s.url),
      type: String(s.type),
      enabled: !!s.enabled,
    }));
  } catch (err) {
    if (isSchemaOutOfDate(err)) ops.sources.schemaReady = false;
    else throw err;
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [{ failed }] = await db
      .select({ failed: sql<number>`count(*)` })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, params.projectId), eq(agentRuns.status, "failed" as any), gte(agentRuns.startedAt, since)));

    const [last] = await db
      .select({ agentKey: agentRuns.agentKey, status: agentRuns.status, finishedAt: agentRuns.finishedAt })
      .from(agentRuns)
      .where(eq(agentRuns.projectId, params.projectId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);

    ops.agentRuns.failed24h = Number(failed ?? 0);
    if (last) {
      ops.agentRuns.lastRun = {
        agentKey: String(last.agentKey),
        status: String(last.status),
        finishedAt: toIsoStringSafe(last.finishedAt),
      };
    }
  } catch (err) {
    if (isSchemaOutOfDate(err)) ops.agentRuns.schemaReady = false;
    else throw err;
  }

  const severityMix = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unscored: 0 };
  try {
    const timeExpr = sql<Date>`coalesce(${findings.publishedAt}, ${findings.createdAt})`;
    const severityText = sql<string>`${findings.severity}::text`;
    const severityExpr = sql<string>`case
      when ${findings.severity} is not null and btrim(${severityText}) <> '' then lower(${severityText})
      when ${findings.cvssScore} is not null then
        case
          when (${findings.cvssScore}::numeric) >= 9 then 'critical'
          when (${findings.cvssScore}::numeric) >= 7 then 'high'
          when (${findings.cvssScore}::numeric) >= 4 then 'medium'
          when (${findings.cvssScore}::numeric) > 0 then 'low'
          else 'unscored'
        end
      else 'unscored'
    end`;

    const rows = await db
      .select({ severity: severityExpr, total: sql<number>`count(*)` })
      .from(findings)
      .where(and(sql`${timeExpr} >= ${bounds.currentStart}`, sql`${timeExpr} < ${bounds.endExclusive}`))
      .groupBy(severityExpr)
      .limit(25);

    for (const r of rows) {
      const key = String(r.severity ?? "unscored");
      const total = Number(r.total ?? 0);
      if (key === "critical") severityMix.critical = total;
      else if (key === "high") severityMix.high = total;
      else if (key === "medium") severityMix.medium = total;
      else if (key === "low") severityMix.low = total;
      else if (key === "info") severityMix.info = total;
      else severityMix.unscored += total;
    }
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
  }

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

  let actionsOverdue = 0;
  if (params.riskAccess) {
    try {
      const now = new Date();
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(navigatorActions)
        .where(
          and(
            eq(navigatorActions.projectId, params.projectId),
            ne(navigatorActions.status, "done"),
            isNotNull(navigatorActions.dueDate),
            lt(navigatorActions.dueDate, now)
          )
        );
      actionsOverdue = Number(total ?? 0);
    } catch {
      actionsOverdue = 0;
    }
  }

  const trendChange = pctChange(trendCurrentTotal, trendPrevTotal);

  const incidentMetrics = await getIncidentMetrics({ db, range: params.range, projectId: params.projectId });
  const effectiveness = await getPlaybookEffectiveness({ db, range: params.range, projectId: params.projectId });

  const attention = {
    navigatorNeedsReviewTotal: null as number | null,
    navigatorUnvalidated: null as number | null,
    navigatorInProgress: null as number | null,
  };

  if (params.riskAccess) {
    try {
      const reviewWhere = [
        eq(navigatorScenarios.projectId, params.projectId),
        sql`${navigatorScenarios.scenarioType} != 'inferred'`,
        inArray(navigatorScenarios.validationStatus, ["unvalidated" as any, "in_progress" as any]),
      ];

      const rows = await db
        .select({
          status: navigatorScenarios.validationStatus,
          total: sql<number>`count(*)`,
        })
        .from(navigatorScenarios)
        .where(and(...reviewWhere))
        .groupBy(navigatorScenarios.validationStatus);

      let unvalidated = 0;
      let inProgress = 0;
      for (const r of rows) {
        const key = String(r.status ?? "");
        const total = Number(r.total ?? 0);
        if (key === "unvalidated") unvalidated = total;
        if (key === "in_progress") inProgress = total;
      }

      attention.navigatorUnvalidated = unvalidated;
      attention.navigatorInProgress = inProgress;
      attention.navigatorNeedsReviewTotal = unvalidated + inProgress;
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
    ops,
    mix: {
      severity: severityMix,
    },
    incidentMetrics: {
      schemaReady: incidentMetrics.schemaReady,
      metrics: incidentMetrics.metrics,
      effectiveness,
    },
    attention,
    kpis: {
      totalFindings: Number(totalFindings ?? 0),
      totalDocs: Number(totalDocs ?? 0),
      enabledAgents,
      totalAgents,
      agentsSchemaReady,
      lastIngestedAt: toIsoStringSafe(lastIngestedAt),
      totalEntities,
      actionsOverdue,
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
  const customize = (() => {
    const raw = String(pickOne(sp.customize) ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  })();

  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const riskAccess = hasNavigatorAccess({ tier: ctx.user.tier });
  const data = await getDashboardData({ range, projectId: ctx.project.id, userId: ctx.user.id, riskAccess });
  const dashboardData = data as any;
  const currentHref = { range: data.range, customize: customize ? "1" : undefined };

  const ingestionHint = (() => {
    if (!data.kpis.agentsSchemaReady) return "Run pnpm db:migrate";
    const last = data.ops.sources.lastFetchedAt ?? data.kpis.lastIngestedAt;
    if (!last) return "Healthy";
    const d = new Date(last);
    if (Number.isNaN(d.getTime())) return "Healthy";
    const stale = data.ops.sources.schemaReady ? Number(data.ops.sources.staleEnabled ?? 0) : 0;
    const staleHint = stale > 0 ? ` • ${nf(stale)} stale sources` : "";
    return `Last ingest: ${d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}${staleHint}`;
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

        <div className="lg:ml-auto w-full lg:w-auto flex flex-col sm:flex-row gap-2">
          <a
            href={buildHref(`/p/${p.projectSlug}`, currentHref, { customize: customize ? undefined : "1" })}
            className="no-print inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
          >
            {customize ? "Done customizing" : "Customize dashboard"}
          </a>

          {riskAccess ? (
            <a
              href={`/p/${p.projectSlug}/reports/executive?print=1`}
              target="_blank"
              rel="noreferrer"
              className="no-print inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2.5 text-sm font-medium hover:opacity-95"
            >
              Export board PDF
            </a>
          ) : (
            <div
              className="no-print inline-flex items-center justify-center rounded-xl bg-zinc-200/70 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 px-4 py-2.5 text-sm font-medium opacity-80"
              title="Available on Pro"
            >
              Export board PDF
            </div>
          )}

          <form action="/findings" method="get" className="w-full lg:w-[560px]">
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
      </div>

      {riskAccess && (data.attention.navigatorUnvalidated ?? 0) >= 100 ? (
        <a
          href={`/p/${p.projectSlug}/navigator?stage=validate&validation=needs_review`}
          className={`mt-6 block rounded-2xl border px-5 py-4 transition-colors ${
            (data.attention.navigatorUnvalidated ?? 0) >= 250
              ? "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/25 hover:bg-rose-50/90 dark:hover:bg-rose-950/35"
              : "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 hover:bg-amber-50/90 dark:hover:bg-amber-950/30"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Navigator backlog</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Validation intake is outpacing review
              </div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Unvalidated scenarios should be triaged to keep detections and playbooks trustworthy.
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {nf(data.attention.navigatorUnvalidated ?? 0)}
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                {nf(data.attention.navigatorInProgress ?? 0)} in review
              </div>
            </div>
          </div>
        </a>
      ) : null}

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
          href="/data/kg-entities"
        />
        <KpiCard
          label="Actions overdue"
          value={!riskAccess ? "Pro" : nf(data.kpis.actionsOverdue)}
          hint="Past due"
          href={`/p/${p.projectSlug}/navigator/actions`}
        />
      </section>

      <CustomizableDashboard
        projectSlug={p.projectSlug}
        riskAccess={riskAccess}
        data={dashboardData}
        tabs={tabs}
        currentHref={currentHref}
        initialEditing={customize}
      />
    </div>
  );
}
