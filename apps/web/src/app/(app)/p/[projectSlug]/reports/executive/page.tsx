export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  complianceControls,
  complianceMappings,
  findings,
  getDb,
  navigatorActionSlaEvents,
  projectComplianceFrameworks,
  riskEntries,
} from "@ti/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { DualLineChart, SparkBars } from "../../../../../../components/dashboard/charts";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { AutoPrint } from "../../../../../../components/reports/AutoPrint";
import { PrintButton } from "../../../../../../components/reports/PrintButton";
import { frameworkLabel, isComplianceFramework, isSchemaOutOfDate } from "../../../../../../lib/compliance";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

type TrendPoint = { label: string; value: number };

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function startOfMonthUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonthsUtc(d: Date, delta: number) {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + delta, 1);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function monthAbbrev(d: Date) {
  return d.toLocaleString("en-US", { month: "short" });
}

async function getFindingsMonthlyTrend(db: ReturnType<typeof getDb>, months: number) {
  const now = new Date();
  const end = now;
  const thisMonth = startOfMonthUtc(now);
  const currentStart = addMonthsUtc(thisMonth, -(months - 1));
  const previousStart = addMonthsUtc(currentStart, -months);

  const dateExpr = sql<Date>`coalesce(${findings.publishedAt}, ${findings.createdAt})`;
  const bucketExpr = sql<string | Date>`date_trunc('month', ${dateExpr})`;
  const totalExpr = sql<number>`count(*)`;

  const rows = await db
    .select({ bucket: bucketExpr, total: totalExpr })
    .from(findings)
    .where(and(sql`${dateExpr} >= ${previousStart}`, sql`${dateExpr} < ${end}`))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr)
    .limit(240);

  const byKey = new Map<string, number>();
  for (const r of rows) {
    const dt = new Date(r.bucket as any);
    if (!Number.isFinite(dt.getTime())) continue;
    byKey.set(dt.toISOString().slice(0, 7), Number(r.total ?? 0));
  }

  const current: TrendPoint[] = [];
  const previous: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const prevMonth = addMonthsUtc(previousStart, i);
    const curMonth = addMonthsUtc(currentStart, i);
    const label = monthAbbrev(curMonth);
    previous.push({ label, value: byKey.get(prevMonth.toISOString().slice(0, 7)) ?? 0 });
    current.push({ label, value: byKey.get(curMonth.toISOString().slice(0, 7)) ?? 0 });
  }

  return { current, previous };
}

async function getTopThreatsThisMonth(db: ReturnType<typeof getDb>) {
  const now = new Date();
  const start = startOfMonthUtc(now);
  const end = now;

  const dateExpr = sql<Date>`coalesce(${findings.publishedAt}, ${findings.createdAt})`;
  const totalExpr = sql<number>`count(*)`;
  const maxCvssExpr = sql<number | null>`max(${findings.cvssScore})`;

  const rows = await db
    .select({
      cveId: findings.cveId,
      total: totalExpr,
      maxCvss: maxCvssExpr,
    })
    .from(findings)
    .where(and(isNotNull(findings.cveId), sql`${dateExpr} >= ${start}`, sql`${dateExpr} < ${end}`))
    .groupBy(findings.cveId)
    .orderBy(desc(totalExpr))
    .limit(8);

  return rows
    .map((r) => ({
      label: String(r.cveId ?? ""),
      total: Number(r.total ?? 0),
      maxCvss: r.maxCvss != null ? Number(r.maxCvss) : null,
    }))
    .filter((r) => r.label);
}

async function getSlaBreachSparks(db: ReturnType<typeof getDb>, projectId: string) {
  const now = new Date();
  const weeks = 12;
  const start = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);

  const bucketExpr = sql<string | Date>`date_trunc('week', ${navigatorActionSlaEvents.at})`;
  const totalExpr = sql<number>`count(*)`;

  const rows = await db
    .select({ bucket: bucketExpr, total: totalExpr })
    .from(navigatorActionSlaEvents)
    .where(
      and(
        eq(navigatorActionSlaEvents.projectId, projectId),
        eq(navigatorActionSlaEvents.kind, "breached" as any),
        sql`${navigatorActionSlaEvents.at} >= ${start}`,
        sql`${navigatorActionSlaEvents.at} < ${now}`
      )
    )
    .groupBy(bucketExpr)
    .orderBy(bucketExpr)
    .limit(weeks + 8);

  const byKey = new Map<string, number>();
  for (const r of rows) {
    const dt = new Date(r.bucket as any);
    if (!Number.isFinite(dt.getTime())) continue;
    byKey.set(dt.toISOString().slice(0, 10), Number(r.total ?? 0));
  }

  const out: Array<{ label: string; value: number }> = [];
  const startWeek = new Date(start);
  startWeek.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < weeks; i++) {
    const d = new Date(startWeek.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    out.push({ label, value: byKey.get(key) ?? 0 });
  }

  return out;
}

export default async function ExecutiveReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const autoPrint = pickOne(sp.print) === "1";

  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  const db = getDb();
  const generatedAt = new Date();

  if (!access) {
    return (
      <div className="h-full min-h-0 mx-auto max-w-[960px] px-8 py-10">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Executive report</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Executive reports are available on Pro.</p>
        <div className="mt-4">
          <Link className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline" href={`/p/${p.projectSlug}`}>
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const topThreats = await getTopThreatsThisMonth(db);
  const findingsTrend = await getFindingsMonthlyTrend(db, 6);

  let riskCounts: Record<string, number> = { open: 0, accepted: 0, mitigating: 0, closed: 0 };
  let riskSchemaReady = true;
  try {
    const rows = await db
      .select({ status: riskEntries.status, total: sql<number>`count(*)` })
      .from(riskEntries)
      .where(eq(riskEntries.projectId, ctx.project.id))
      .groupBy(riskEntries.status)
      .limit(20);

    for (const r of rows) {
      const k = String(r.status ?? "");
      if (!k) continue;
      riskCounts[k] = Number(r.total ?? 0);
    }
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    riskSchemaReady = false;
  }

  type ComplianceSummary = { framework: string; label: string; mapped: number; total: number; coveragePct: number };
  let complianceSchemaReady = true;
  let compliance: ComplianceSummary[] = [];
  try {
    const fwRows = await db
      .select({ framework: projectComplianceFrameworks.framework })
      .from(projectComplianceFrameworks)
      .where(eq(projectComplianceFrameworks.projectId, ctx.project.id))
      .limit(20);

    const enabled = fwRows.map((r) => String(r.framework)).filter(isComplianceFramework);
    const summaries: ComplianceSummary[] = [];

    for (const framework of enabled) {
      const [{ totalControls }] = await db
        .select({ totalControls: sql<number>`count(*)` })
        .from(complianceControls)
        .where(eq(complianceControls.framework, framework as any));

      const [{ mappedControls }] = await db
        .select({ mappedControls: sql<number>`count(distinct ${complianceMappings.controlId})` })
        .from(complianceMappings)
        .where(and(eq(complianceMappings.projectId, ctx.project.id), eq(complianceMappings.framework, framework as any)));

      const total = Number(totalControls ?? 0);
      const mapped = Number(mappedControls ?? 0);
      const pct = total > 0 ? mapped / total : 0;
      summaries.push({ framework, label: frameworkLabel(framework), mapped, total, coveragePct: clamp01(pct) });
    }

    compliance = summaries;
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    complianceSchemaReady = false;
  }

  let slaSpark: Array<{ label: string; value: number }> = [];
  let slaSchemaReady = true;
  try {
    slaSpark = await getSlaBreachSparks(db, ctx.project.id);
  } catch (err) {
    if (!isSchemaOutOfDate(err)) throw err;
    slaSchemaReady = false;
    slaSpark = [];
  }

  return (
    <div className="h-full min-h-0 mx-auto max-w-[1080px] px-8 py-10">
      <AutoPrint enabled={autoPrint} />

      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <Link className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline" href={`/p/${p.projectSlug}`}>
          ← Back
        </Link>
        <PrintButton
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-sm font-medium hover:opacity-95"
        >
          Export PDF
        </PrintButton>
      </div>

      <header className="flex flex-col gap-2">
        <div className="text-xs text-zinc-500">Executive / Board report</div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{ctx.project.name}</h1>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Generated {generatedAt.toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" })}
        </div>
      </header>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Top threats this month"
            description="Top CVEs by volume in the current month."
            right={<span className="text-xs text-zinc-500">{startOfMonthUtc(generatedAt).toLocaleString("en-US", { month: "long" })}</span>}
          />
          <CardContent>
            {topThreats.length ? (
              <div className="space-y-2">
                {topThreats.map((t) => (
                  <div key={t.label} className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.label}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {nf(t.total)}
                      {typeof t.maxCvss === "number" ? <span className="ml-2 text-xs">(max CVSS {t.maxCvss.toFixed(1)})</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No CVE-tagged findings this month yet.</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Risk register status" description="Counts by current workflow state." />
          <CardContent>
            {!riskSchemaReady ? (
              <div className="text-sm text-zinc-500">
                Risk tables are missing or out of date. Run <span className="font-mono">pnpm db:migrate</span>.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Open", key: "open" },
                  { label: "Mitigating", key: "mitigating" },
                  { label: "Accepted", key: "accepted" },
                  { label: "Closed", key: "closed" },
                ].map((s) => (
                  <div key={s.key} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(riskCounts[s.key] ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Compliance posture" description="Control coverage by enabled framework." />
          <CardContent>
            {!complianceSchemaReady ? (
              <div className="text-sm text-zinc-500">
                Compliance tables are missing or out of date. Run <span className="font-mono">pnpm db:migrate</span>.
              </div>
            ) : compliance.length ? (
              <div className="space-y-3">
                {compliance.map((f) => (
                  <div key={f.framework}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{f.label}</div>
                      <div className="text-zinc-600 dark:text-zinc-400 tabular-nums">
                        {Math.round(f.coveragePct * 100)}% ({nf(f.mapped)}/{nf(f.total)})
                      </div>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                      <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${Math.round(f.coveragePct * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No frameworks enabled yet. Go to Compliance to enable one.</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Trends" description="Findings volume and SLA breaches." />
          <CardContent>
            <div className="space-y-5">
              <div>
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Findings volume (6 months)</div>
                <div className="mt-2">
                  <DualLineChart primary={findingsTrend.current} secondary={findingsTrend.previous} height={210} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">SLA breaches (12 weeks)</div>
                  {!slaSchemaReady ? <div className="text-[11px] text-zinc-500">Run pnpm db:migrate</div> : null}
                </div>
                <div className="mt-2">
                  <SparkBars data={slaSpark} height={82} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="mt-8 text-xs text-zinc-500">
        Generated by Threat Intel Platform • {ctx.project.slug}
      </footer>
    </div>
  );
}
