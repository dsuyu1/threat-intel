"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildHref } from "../../lib/search-params";
import { Card, CardContent, CardHeader } from "../ui/Card";
import { DonutChart, DualLineChart } from "./charts";
import { IncidentMetricsCard } from "./IncidentMetricsCard";
import { SourceLogoStrip } from "./SourceLogoStrip";

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

type SourceRow = {
  id: string;
  name: string;
  url: string;
  type: string;
  enabled: boolean;
};

export type DashboardData = {
  range: RangeId;
  rangeLabel: string;
  trend: { current: TrendPoint[]; previous: TrendPoint[]; changePct: number | null };
  mix: { severity: { critical: number; high: number; medium: number; low: number; info: number; unscored: number } };
  ops: {
    sources: {
      schemaReady: boolean;
      total: number;
      enabled: number;
      staleEnabled: number;
      lastFetchedAt: string | null;
      all: SourceRow[];
    };
    agentRuns: {
      schemaReady: boolean;
      failed24h: number;
      lastRun: null | { agentKey: string; status: string; finishedAt: string | null };
    };
  };
  incidentMetrics: {
    schemaReady: boolean;
    metrics: unknown;
    effectiveness: unknown;
  };
  attention: {
    navigatorNeedsReviewTotal: number | null;
    navigatorUnvalidated: number | null;
    navigatorInProgress: number | null;
  };
  kpis: {
    actionsOverdue: number;
  };
  riskSchemaReady: boolean;
  risk: null | {
    openCount: number;
    overToleranceCount: number;
    openResidual: number;
    trend: { current: TrendPoint[]; previous: TrendPoint[]; changePct: number | null };
  };
  latestFindings: FindingRow[];
};

type LaneId = "left" | "right" | "footer";

type WidgetId =
  | "findingsReport"
  | "incidentResponse"
  | "opsHealth"
  | "riskTrend"
  | "findingMix"
  | "latestFindings"
  | "needsAttention"
  | "sources"
  | "quickLinks"
  | "severitySnapshot"
  | "nextActions";

type Layout = Record<LaneId, WidgetId[]>;

const DEFAULT_LAYOUT: Layout = {
  left: ["findingsReport", "incidentResponse", "latestFindings"],
  right: ["opsHealth", "riskTrend", "findingMix", "needsAttention"],
  footer: ["sources"],
};

const WIDGET_DEFS: Record<
  WidgetId,
  { title: string; description: string; defaultLane: LaneId }
> = {
  findingsReport: {
    title: "Findings report",
    description: "Published volume (current vs previous period).",
    defaultLane: "left",
  },
  incidentResponse: {
    title: "Incident response",
    description: "Incident MTTA/MTTR and playbook effectiveness.",
    defaultLane: "left",
  },
  opsHealth: {
    title: "Ops health",
    description: "Ingestion + agent runs (24h).",
    defaultLane: "right",
  },
  riskTrend: {
    title: "Risk trend",
    description: "Open residual exposure (last 14 days).",
    defaultLane: "right",
  },
  findingMix: {
    title: "Finding mix",
    description: "Severity breakdown.",
    defaultLane: "right",
  },
  latestFindings: {
    title: "Latest findings",
    description: "Most recent items across all agents.",
    defaultLane: "left",
  },
  needsAttention: {
    title: "Needs attention",
    description: "What to triage right now.",
    defaultLane: "right",
  },
  sources: {
    title: "Sources",
    description: "Live feeds powering ingestion (RSS + STIX).",
    defaultLane: "footer",
  },
  quickLinks: {
    title: "Quick links",
    description: "Jump to common workflows.",
    defaultLane: "right",
  },
  severitySnapshot: {
    title: "Severity snapshot",
    description: "At-a-glance counts by band.",
    defaultLane: "right",
  },
  nextActions: {
    title: "Next actions",
    description: "Suggested follow-ups based on current signals.",
    defaultLane: "left",
  },
};

function normalizeLayout(input: unknown): Layout {
  const out: Layout = { left: [], right: [], footer: [] };
  if (!input || typeof input !== "object") return DEFAULT_LAYOUT;

  const obj = input as Partial<Record<LaneId, unknown>>;
  const seen = new Set<WidgetId>();
  (["left", "right", "footer"] as const).forEach((lane) => {
    const list = obj[lane];
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (typeof raw !== "string") continue;
      if (!(raw in WIDGET_DEFS)) continue;
      const id = raw as WidgetId;
      if (seen.has(id)) continue;
      seen.add(id);
      out[lane].push(id);
    }
  });

  const total = out.left.length + out.right.length + out.footer.length;
  return total ? out : DEFAULT_LAYOUT;
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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

function setCustomizeParam(enabled: boolean) {
  try {
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set("customize", "1");
    else url.searchParams.delete("customize");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL sync failures (non-browser envs / malformed URL).
  }
}

function layoutHasWidget(layout: Layout, id: WidgetId) {
  return layout.left.includes(id) || layout.right.includes(id) || layout.footer.includes(id);
}

function removeWidgetFromLayout(layout: Layout, id: WidgetId): Layout {
  return {
    left: layout.left.filter((x) => x !== id),
    right: layout.right.filter((x) => x !== id),
    footer: layout.footer.filter((x) => x !== id),
  };
}

function moveWidget(layout: Layout, params: { id: WidgetId; toLane: LaneId; toIndex: number }): Layout {
  const fromLane: LaneId =
    layout.left.includes(params.id) ? "left" : layout.right.includes(params.id) ? "right" : "footer";
  const fromList = layout[fromLane];
  const toList = layout[params.toLane];
  const fromIndex = fromList.indexOf(params.id);
  const targetIndex = Math.max(0, Math.min(params.toIndex, toList.length));

  const next: Layout = {
    left: [...layout.left],
    right: [...layout.right],
    footer: [...layout.footer],
  };

  next[fromLane] = next[fromLane].filter((x) => x !== params.id);
  next[params.toLane] = next[params.toLane].filter((x) => x !== params.id);

  let insertIndex = targetIndex;
  if (fromLane === params.toLane && fromIndex >= 0 && fromIndex < targetIndex) insertIndex = Math.max(0, targetIndex - 1);

  next[params.toLane].splice(insertIndex, 0, params.id);
  return next;
}

export function CustomizableDashboard({
  projectSlug,
  riskAccess,
  data,
  tabs,
  currentHref,
  initialEditing = false,
}: {
  projectSlug: string;
  riskAccess: boolean;
  data: DashboardData;
  tabs: Array<{ id: RangeId; label: string }>;
  currentHref: Record<string, string | undefined>;
  initialEditing?: boolean;
}) {
  const storageKey = `ti.dashboard.layout.v1:${projectSlug}`;
  const [editing, setEditing] = useState<boolean>(initialEditing);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const hasLoadedRef = useRef(false);

  const [picker, setPicker] = useState<{ open: boolean; lane: LaneId | null }>({ open: false, lane: null });
  const dragRef = useRef<null | { id: WidgetId }>(null);

  const allWidgetIds = useMemo(() => Object.keys(WIDGET_DEFS) as WidgetId[], []);
  const availableToAdd = useMemo(() => allWidgetIds.filter((id) => !layoutHasWidget(layout, id)), [allWidgetIds, layout]);

  useEffect(() => {
    setEditing(initialEditing);
  }, [initialEditing]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setLayout(normalizeLayout(JSON.parse(raw)));
    } catch {
      setLayout(DEFAULT_LAYOUT);
    } finally {
      hasLoadedRef.current = true;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Ignore localStorage failures (private mode).
    }
  }, [layout, storageKey]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!picker.open) return;
      if (e.key === "Escape") setPicker({ open: false, lane: null });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picker.open]);

  const toggleEditing = (next: boolean) => {
    setEditing(next);
    setCustomizeParam(next);
  };

  const onRemove = (id: WidgetId) => setLayout((prev) => removeWidgetFromLayout(prev, id));

  const onAdd = (id: WidgetId, lane: LaneId) => {
    setLayout((prev) => {
      const next = removeWidgetFromLayout(prev, id);
      return { ...next, [lane]: [...next[lane], id] };
    });
  };

  const openPicker = (lane: LaneId) => setPicker({ open: true, lane });

  const renderWidget = (id: WidgetId) => {
    if (id === "findingsReport") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Findings report"
            description={`${data.rangeLabel} published volume (current vs previous period).`}
            border={false}
            className="px-4 py-3"
            right={
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-1">
                  {tabs.map((t) => {
                    const active = t.id === data.range;
                    return (
                      <a
                        key={t.id}
                        href={buildHref(`/p/${projectSlug}`, currentHref, { range: t.id })}
                        className={clsx(
                          "rounded-lg px-2.5 py-1 text-xs font-medium",
                          active
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                        )}
                      >
                        {t.label}
                      </a>
                    );
                  })}
                </div>

                {typeof data.trend.changePct === "number" ? (
                  <div
                    className={clsx(
                      "hidden sm:inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums",
                      data.trend.changePct >= 0
                        ? "border-emerald-200/70 dark:border-emerald-900/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-rose-200/70 dark:border-rose-900/50 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    )}
                    title="Percent change vs previous period: (current - previous) / previous. Hidden when previous is 0."
                  >
                    <span aria-hidden="true">{data.trend.changePct >= 0 ? "↑" : "↓"}</span>
                    <span className="ml-1">{Math.round(data.trend.changePct)}%</span>
                  </div>
                ) : null}

                <a
                  href="/findings"
                  className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                >
                  Open feed
                </a>
              </div>
            }
          />
          <CardContent dense className="pt-2 pb-2">
            <DualLineChart
              primary={data.trend.current}
              secondary={data.trend.previous}
              height={210}
              showRangeLabels={false}
              showEndpointLabelsInChart
              xLabel={data.range.endsWith("m") ? "Month" : "Day"}
              yLabel="Findings"
              showYAxisTickLabels
            />
          </CardContent>
        </Card>
      );
    }

    if (id === "incidentResponse") {
      return (
        <IncidentMetricsCard
          schemaReady={data.incidentMetrics.schemaReady}
          rangeLabel={data.rangeLabel}
          metrics={data.incidentMetrics.metrics as any}
          effectiveness={data.incidentMetrics.effectiveness as any}
        />
      );
    }

    if (id === "opsHealth") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            dense
            title="Ops health"
            description="Ingestion + agent runs (24h)."
            border={false}
            right={
              <a href="/agents" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                Open
              </a>
            }
          />
          <CardContent dense>
            {!data.ops.agentRuns.schemaReady ? (
              <div className="py-2 text-sm text-zinc-500">
                Agent run tables are missing. Run <span className="font-mono">pnpm db:migrate</span>.
              </div>
            ) : (
              <div className="space-y-2">
                <a
                  href="/data/sources"
                  className={clsx(
                    "block rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5",
                    Number(data.ops.sources.staleEnabled ?? 0) > 0
                      ? "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20"
                      : "border-zinc-200/70 dark:border-zinc-800/80"
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Sources freshness</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
                        {nf(Number(data.ops.sources.enabled ?? 0))} enabled • {nf(Number(data.ops.sources.staleEnabled ?? 0))} stale
                      </div>
                    </div>
                    <div className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {data.ops.sources.lastFetchedAt
                        ? new Date(data.ops.sources.lastFetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </div>
                  </div>
                </a>

                <a
                  href="/agents"
                  className={clsx(
                    "block rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5",
                    Number(data.ops.agentRuns.failed24h ?? 0) > 0
                      ? "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20"
                      : "border-zinc-200/70 dark:border-zinc-800/80"
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Agent failures</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
                        {nf(Number(data.ops.agentRuns.failed24h ?? 0))} failed
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-zinc-500">Last run</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {data.ops.agentRuns.lastRun ? `${data.ops.agentRuns.lastRun.agentKey} • ${data.ops.agentRuns.lastRun.status}` : "—"}
                      </div>
                    </div>
                  </div>
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    if (id === "riskTrend") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Risk trend"
            description="Open residual exposure (last 14 days)."
            border={false}
            right={
              <a href={`/p/${projectSlug}/risk`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
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
                  <div
                    className="mt-2 text-[11px] text-zinc-500"
                    title="Percent change vs previous period: (current - previous) / previous. Hidden when previous is 0."
                  >
                    Period change: <span className="tabular-nums">{Math.round(data.risk.trend.changePct)}%</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="py-4 text-sm text-zinc-500">Validate a Navigator scenario to start tracking risk.</div>
            )}
          </CardContent>
        </Card>
      );
    }

    if (id === "findingMix") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Finding mix"
            description={`${data.rangeLabel} severity breakdown.`}
            border={false}
            right={
              <a href="/findings" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                Open feed
              </a>
            }
          />
          <CardContent className="pt-2">
            <DonutChart
              title="Finding severity mix"
              segments={[
                { label: "Critical", value: Number(data.mix.severity.critical ?? 0), color: "rgb(244 63 94)", href: "/findings?band=critical" },
                { label: "High", value: Number(data.mix.severity.high ?? 0), color: "rgb(249 115 22)", href: "/findings?band=high" },
                { label: "Medium", value: Number(data.mix.severity.medium ?? 0), color: "rgb(245 158 11)", href: "/findings?band=medium" },
                { label: "Low", value: Number(data.mix.severity.low ?? 0), color: "rgb(16 185 129)", href: "/findings?band=low" },
                { label: "Info", value: Number(data.mix.severity.info ?? 0), color: "rgb(14 165 233)", href: "/findings?band=unscored" },
                { label: "Unscored", value: Number(data.mix.severity.unscored ?? 0), color: "rgb(113 113 122)", href: "/findings?band=unscored" },
              ]}
            />
          </CardContent>
        </Card>
      );
    }

    if (id === "latestFindings") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
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
                          <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", severityMeta.className)}>
                            {severityMeta.label}
                          </span>
                          <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", agentMeta.className)}>
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
      );
    }

    if (id === "needsAttention") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader
            title="Needs attention"
            description="What to triage right now."
            border={false}
            right={
              <a href={`/p/${projectSlug}/risk`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                Open
              </a>
            }
          />
          <CardContent className="pt-2">
            <div className="space-y-2">
              <a
                href={`/p/${projectSlug}/navigator?stage=validate&validation=needs_review`}
                className={clsx(
                  "flex items-center justify-between gap-4 rounded-xl px-3 py-3 border transition-colors",
                  !riskAccess
                    ? "border-zinc-200/60 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5"
                    : (data.attention.navigatorUnvalidated ?? 0) >= 250
                      ? "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-50/80 dark:hover:bg-rose-950/30"
                      : (data.attention.navigatorUnvalidated ?? 0) >= 100
                        ? "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50/80 dark:hover:bg-amber-950/30"
                        : "border-zinc-200/60 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Navigator review backlog</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">Unvalidated and in progress (excludes inferred).</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {!riskAccess ? "Pro" : nf(data.attention.navigatorUnvalidated ?? 0)}
                  </div>
                  {riskAccess ? (
                    <div className="mt-0.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {nf(data.attention.navigatorInProgress ?? 0)} in review
                    </div>
                  ) : null}
                </div>
              </a>

              <a
                href={`/p/${projectSlug}/risk`}
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

              {data.kpis.actionsOverdue > 0 ? (
                <a
                  href={`/p/${projectSlug}/navigator/actions`}
                  className="flex items-center justify-between gap-4 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Overdue actions</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">Risk mitigations past due date.</div>
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {!riskAccess ? "Pro" : nf(data.kpis.actionsOverdue)}
                  </div>
                </a>
              ) : null}
            </div>
          </CardContent>
        </Card>
      );
    }

    if (id === "sources") {
      return (
        <div>
          {data.ops.sources.schemaReady ? (
            <SourceLogoStrip
              sources={data.ops.sources.all}
              wrap
              maxHeight={260}
              description={
                <span className="tabular-nums">
                  {nf(Number(data.ops.sources.total ?? 0))} total • {nf(Number(data.ops.sources.enabled ?? 0))} enabled •{" "}
                  {nf(Number(data.ops.sources.staleEnabled ?? 0))} stale (24h) • Last fetch:{" "}
                  {data.ops.sources.lastFetchedAt
                    ? new Date(data.ops.sources.lastFetchedAt).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </span>
              }
              right={
                <div className="flex items-center gap-3">
                  <a href="/data/sources" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Manage
                  </a>
                  <a href="/data/sources/new" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Add
                  </a>
                </div>
              }
            />
          ) : (
            <Card className="shadow-sm dark:shadow-black/30">
              <CardHeader
                title="Sources"
                description="RSS + STIX feeds powering ingestion."
                border={false}
                right={
                  <a href="/data/sources" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Open
                  </a>
                }
              />
              <CardContent className="pt-2">
                <div className="py-4 text-sm text-zinc-500">
                  Source tables are missing. Run <span className="font-mono">pnpm db:migrate</span>.
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      );
    }

    if (id === "quickLinks") {
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Quick links" description="Jump to common workflows." border={false} />
          <CardContent className="pt-2">
            <div className="space-y-1">
              {[
                { label: "Findings feed", href: "/findings" },
                { label: "Manage sources", href: "/data/sources" },
                { label: "Add a source", href: "/data/sources/new" },
                { label: "Agents", href: "/agents" },
                { label: "Navigator", href: `/p/${projectSlug}/navigator` },
                { label: "Risk", href: `/p/${projectSlug}/risk` },
              ].map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-zinc-800 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <span>{l.label}</span>
                  <span className="text-xs text-zinc-400">→</span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    if (id === "severitySnapshot") {
      const rows: Array<{ label: string; value: number; color: string; href: string }> = [
        { label: "Critical", value: Number(data.mix.severity.critical ?? 0), color: "rgb(244 63 94)", href: "/findings?band=critical" },
        { label: "High", value: Number(data.mix.severity.high ?? 0), color: "rgb(249 115 22)", href: "/findings?band=high" },
        { label: "Medium", value: Number(data.mix.severity.medium ?? 0), color: "rgb(245 158 11)", href: "/findings?band=medium" },
        { label: "Low", value: Number(data.mix.severity.low ?? 0), color: "rgb(16 185 129)", href: "/findings?band=low" },
        { label: "Unscored", value: Number(data.mix.severity.unscored ?? 0), color: "rgb(113 113 122)", href: "/findings?band=unscored" },
      ];
      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Severity snapshot" description={`${data.rangeLabel} totals by band.`} border={false} />
          <CardContent className="pt-2">
            <div className="space-y-1.5">
              {rows.map((r) => (
                <a
                  key={r.label}
                  href={r.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} aria-hidden="true" />
                  <span className="text-sm text-zinc-800 dark:text-zinc-200">{r.label}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {nf(r.value)}
                  </span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    if (id === "nextActions") {
      const actions: Array<{ label: string; hint: string; href: string }> = [];
      const stale = Number(data.ops.sources.staleEnabled ?? 0);
      const failed = Number(data.ops.agentRuns.failed24h ?? 0);
      const unvalidated = Number(data.attention.navigatorUnvalidated ?? 0);
      const overdue = Number(data.kpis.actionsOverdue ?? 0);

      if (stale > 0) actions.push({ label: "Fix stale sources", hint: `${nf(stale)} feeds haven’t fetched in 24h.`, href: "/data/sources" });
      if (failed > 0) actions.push({ label: "Investigate agent failures", hint: `${nf(failed)} runs failed in the last 24h.`, href: "/agents" });
      if (riskAccess && unvalidated >= 100) actions.push({ label: "Triage Navigator backlog", hint: `${nf(unvalidated)} scenarios awaiting validation.`, href: `/p/${projectSlug}/navigator?stage=validate&validation=needs_review` });
      if (riskAccess && overdue > 0) actions.push({ label: "Review overdue actions", hint: `${nf(overdue)} risk actions are past due.`, href: `/p/${projectSlug}/navigator/actions` });
      if (!actions.length) actions.push({ label: "Review latest findings", hint: "Scan the most recent agent output.", href: "/findings" });

      return (
        <Card className="shadow-sm dark:shadow-black/30">
          <CardHeader title="Next actions" description="Suggested follow-ups based on current signals." border={false} />
          <CardContent className="pt-2">
            <div className="space-y-2">
              {actions.map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  className="block rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{a.label}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">{a.hint}</div>
                    </div>
                    <div className="shrink-0 text-zinc-400" aria-hidden="true">
                      →
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  const Lane = ({ lane }: { lane: LaneId }) => {
    const ids = layout[lane];
    return (
      <div
        className={clsx("flex flex-col gap-4", lane === "footer" ? "mt-6" : null)}
        onDragOver={(e) => {
          if (!editing) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!editing) return;
          e.preventDefault();
          const raw = e.dataTransfer.getData("text/plain");
          const id = (raw as WidgetId) || dragRef.current?.id;
          if (!id || !(id in WIDGET_DEFS)) return;
          setLayout((prev) => moveWidget(prev, { id, toLane: lane, toIndex: prev[lane].length }));
        }}
      >
        {ids.map((id, idx) => {
          const content = renderWidget(id);
          if (!content) return null;

          return (
            <div
              key={id}
              draggable={editing}
              onDragStart={(e) => {
                if (!editing) return;
                dragRef.current = { id };
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
              }}
              onDragEnd={() => {
                dragRef.current = null;
              }}
              onDragOver={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.stopPropagation();
                const raw = e.dataTransfer.getData("text/plain");
                const dragged = (raw as WidgetId) || dragRef.current?.id;
                if (!dragged || !(dragged in WIDGET_DEFS)) return;
                setLayout((prev) => moveWidget(prev, { id: dragged, toLane: lane, toIndex: idx }));
              }}
              className={clsx(editing ? "cursor-move" : null)}
            >
              {editing ? (
                <div className="relative">
                  <div className="absolute -inset-0.5 rounded-2xl border border-dashed border-indigo-500/40 pointer-events-none" />
                  <div className="absolute left-3 top-3 text-[11px] font-medium text-indigo-600 dark:text-indigo-300 select-none">
                    Drag
                  </div>
                  <button
                    type="button"
                    className="absolute right-3 top-3 inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-black/50 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/60"
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      onRemove(id);
                    }}
                    aria-label={`Remove ${WIDGET_DEFS[id].title}`}
                  >
                    Remove
                  </button>
                  <div className="pointer-events-none opacity-80">{content}</div>
                </div>
              ) : (
                content
              )}
            </div>
          );
        })}

        {editing ? (
          <button
            type="button"
            className={clsx(
              "rounded-2xl border-2 border-dashed px-4 py-8 text-left transition-colors",
              availableToAdd.length
                ? "border-zinc-300/70 dark:border-zinc-700/70 hover:bg-black/5 dark:hover:bg-white/5"
                : "border-zinc-200/50 dark:border-zinc-800/50 opacity-60 cursor-not-allowed"
            )}
            onClick={() => {
              if (!availableToAdd.length) return;
              openPicker(lane);
            }}
            disabled={!availableToAdd.length}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500">
                +
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Add a widget</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">Choose from {availableToAdd.length} available widgets.</div>
              </div>
            </div>
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <section className="mt-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">Widgets</div>
          <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
            {editing ? "Drag cards to reorder, remove, or add new widgets." : "Customize your dashboard layout."}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                onClick={() => {
                  setLayout(DEFAULT_LAYOUT);
                  try {
                    localStorage.removeItem(storageKey);
                  } catch {
                    // ignore
                  }
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
                onClick={() => toggleEditing(false)}
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
              onClick={() => toggleEditing(true)}
            >
              Customize dashboard
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <Lane lane="left" />
        </div>
        <div className="lg:col-span-1">
          <Lane lane="right" />
        </div>
      </div>

      <Lane lane="footer" />

      {picker.open && picker.lane ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add widget"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPicker({ open: false, lane: null });
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-200/70 dark:border-zinc-800/80 px-5 py-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add a widget</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Pick a widget to add to <span className="font-mono">{picker.lane}</span>.
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setPicker({ open: false, lane: null })}
              >
                Close
              </button>
            </div>

            <div className="p-4">
              {availableToAdd.length ? (
                <div className="grid grid-cols-1 gap-2">
                  {availableToAdd.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="text-left rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={() => {
                        onAdd(id, picker.lane!);
                        setPicker({ open: false, lane: null });
                      }}
                    >
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{WIDGET_DEFS[id].title}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">{WIDGET_DEFS[id].description}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-zinc-500">No more widgets to add.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
