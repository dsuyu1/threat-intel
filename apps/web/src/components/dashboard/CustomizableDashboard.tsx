"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { buildHref } from "../../lib/search-params";
import { Card, CardContent, CardHeader } from "../ui/Card";
import { DualLineChart, DonutChart } from "./charts";
import { IncidentMetricsCard } from "./IncidentMetricsCard";
import { SourceLogoStrip } from "./SourceLogoStrip";

type RangeTab = { id: string; label: string };

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

type ContainerId = "left" | "right" | "footer";

type LayoutState = {
  v: 1;
  containers: Record<ContainerId, string[]>;
};

type WidgetCtx = {
  projectSlug: string;
  riskAccess: boolean;
  tabs: RangeTab[];
  data: any;
  ingestionHint: string;
};

type WidgetDef = {
  id: string;
  title: string;
  description: string;
  defaultContainer: ContainerId;
  render: (ctx: WidgetCtx) => React.ReactNode;
};

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
    info: { label: "info", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20" },
    unscored: { label: "unscored", className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" },
  };
  return smap[value] ?? { label: value, className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20" };
}

function storageKey(projectSlug: string) {
  return `ti.dashboard.layout.v1:${projectSlug}`;
}

function safeParseLayout(raw: string | null): LayoutState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    if (!parsed || parsed.v !== 1 || !parsed.containers) return null;
    const left = parsed.containers.left;
    const right = parsed.containers.right;
    const footer = parsed.containers.footer ?? [];
    if (!Array.isArray(left) || !Array.isArray(right) || !Array.isArray(footer)) return null;
    return { v: 1, containers: { left, right, footer } };
  } catch {
    return null;
  }
}

function uniqKnown(ids: string[], known: Set<string>, seen: Set<string>) {
  const out: string[] = [];
  for (const id of ids) {
    if (!known.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeLayout(input: LayoutState, registry: Record<string, WidgetDef>, fallback: LayoutState): LayoutState {
  const known = new Set(Object.keys(registry));
  const seen = new Set<string>();
  const left = uniqKnown(input.containers.left ?? [], known, seen);
  const right = uniqKnown(input.containers.right ?? [], known, seen);
  const footer = uniqKnown(input.containers.footer ?? [], known, seen);

  const empty = left.length === 0 && right.length === 0 && footer.length === 0;
  if (empty) return fallback;
  return { v: 1, containers: { left, right, footer } };
}

function computeDefaultLayout(registry: Record<string, WidgetDef>) {
  const left: string[] = [];
  const right: string[] = [];
  const footer: string[] = [];

  const push = (id: string, container: ContainerId) => {
    if (!registry[id]) return;
    (container === "left" ? left : container === "right" ? right : footer).push(id);
  };

  push("findings_report", "left");
  push("incident_response", "left");
  push("latest_findings", "left");
  push("ops_health", "right");
  push("risk_trend", "right");
  push("finding_mix", "right");
  push("needs_attention", "right");
  push("sources", "footer");

  return { v: 1, containers: { left, right, footer } } satisfies LayoutState;
}

function moveItem(params: {
  layout: LayoutState;
  activeId: string;
  overId: string | null;
  overContainer: ContainerId | null;
  overInsertAfter?: boolean;
  registry: Record<string, WidgetDef>;
}) {
  const { layout, activeId, overId, overContainer, overInsertAfter, registry } = params;
  if (!registry[activeId]) return layout;

  const containers: ContainerId[] = ["left", "right", "footer"];
  const fromContainer =
    containers.find((c) => layout.containers[c].includes(activeId)) ?? null;
  const toContainer =
    (overContainer && containers.includes(overContainer) ? overContainer : null) ??
    (overId ? containers.find((c) => layout.containers[c].includes(overId)) ?? null : null);

  if (!fromContainer || !toContainer) return layout;

  const fromItems = [...layout.containers[fromContainer]];
  const toItems = fromContainer === toContainer ? fromItems : [...layout.containers[toContainer]];

  const fromIndex = fromItems.indexOf(activeId);
  if (fromIndex < 0) return layout;

  fromItems.splice(fromIndex, 1);

  let insertAt = toItems.length;
  if (overId) {
    const overIndex = toItems.indexOf(overId);
    if (overIndex >= 0) insertAt = overInsertAfter ? overIndex + 1 : overIndex;
  }
  insertAt = Math.max(0, Math.min(insertAt, toItems.length));

  toItems.splice(insertAt, 0, activeId);

  const next: LayoutState = { v: 1, containers: { ...layout.containers } };
  next.containers[fromContainer] = fromItems;
  next.containers[toContainer] = toItems;
  return next;
}

function WidgetShell(props: {
  title: string;
  editing: boolean;
  dragging: boolean;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "relative",
        props.dragging ? "opacity-60" : null,
        props.editing ? "group" : null
      )}
    >
      {props.editing ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/50"
            onClick={props.onRemove}
            aria-label={`Remove ${props.title}`}
          >
            Remove
          </button>
          <button
            type="button"
            draggable
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            className="cursor-grab rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/50 active:cursor-grabbing"
            aria-label={`Drag ${props.title}`}
            title="Drag to rearrange"
          >
            Drag
          </button>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

function AddWidgetTile(props: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={clsx(
        "w-full rounded-2xl border border-dashed px-4 py-4 text-left transition-colors",
        "border-zinc-300/80 dark:border-zinc-700/70",
        "bg-white/40 dark:bg-black/20 hover:bg-white/60 dark:hover:bg-black/30",
        "disabled:opacity-50 disabled:hover:bg-white/40 disabled:dark:hover:bg-black/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/30 text-zinc-700 dark:text-zinc-200">
          +
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Add a widget</div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">Pick from available widgets.</div>
        </div>
      </div>
    </button>
  );
}

function WidgetPickerModal(props: {
  open: boolean;
  onClose: () => void;
  widgets: WidgetDef[];
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!props.open) setQ("");
  }, [props.open]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return props.widgets;
    return props.widgets.filter((w) => {
      const hay = `${w.title} ${w.description}`.toLowerCase();
      return hay.includes(query);
    });
  }, [props.widgets, q]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close widget picker"
        onClick={props.onClose}
      />
      <div className="absolute left-1/2 top-10 w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 shadow-2xl shadow-black/15 dark:shadow-black/70 backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/70 dark:border-zinc-800/80 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add a widget</div>
            <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Choose a widget to add to your dashboard.
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
          >
            Done
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true">
              ⌕
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search widgets"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/30 px-10 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 max-h-[60vh] overflow-auto pr-1">
            {filtered.length ? (
              filtered.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="text-left rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-3 hover:bg-white dark:hover:bg-black/40 transition-colors"
                  onClick={() => props.onPick(w.id)}
                >
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{w.title}</div>
                  <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{w.description}</div>
                </button>
              ))
            ) : (
              <div className="py-8 text-sm text-zinc-500">No widgets match that search.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CustomizableDashboard(props: {
  projectSlug: string;
  riskAccess: boolean;
  tabs: RangeTab[];
  data: any;
  ingestionHint: string;
}) {
  const ctx: WidgetCtx = {
    projectSlug: props.projectSlug,
    riskAccess: props.riskAccess,
    tabs: props.tabs,
    data: props.data,
    ingestionHint: props.ingestionHint,
  };

  const registry: Record<string, WidgetDef> = useMemo(() => {
    const widgets: WidgetDef[] = [
      {
        id: "findings_report",
        title: "Findings report",
        description: "Published volume trend (current vs previous).",
        defaultContainer: "left",
        render: ({ projectSlug, tabs, data }) => {
          const currentHref = { range: data.range };
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

                    {typeof data.trend.changePct === "number" ? (
                      <div
                        className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums ${
                          data.trend.changePct >= 0
                            ? "border-emerald-200/70 dark:border-emerald-900/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-rose-200/70 dark:border-rose-900/50 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        }`}
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
        },
      },
      {
        id: "incident_response",
        title: "Incident response",
        description: "MTTD/MTTR/Containment trends and playbook score.",
        defaultContainer: "left",
        render: ({ data }) => (
          <IncidentMetricsCard
            schemaReady={data.incidentMetrics.schemaReady}
            rangeLabel={data.rangeLabel}
            metrics={data.incidentMetrics.metrics}
            effectiveness={data.incidentMetrics.effectiveness}
          />
        ),
      },
      {
        id: "ops_health",
        title: "Ops health",
        description: "Ingestion + agent runs (24h).",
        defaultContainer: "right",
        render: ({ data }) => (
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
                    className={`block rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                      Number(data.ops.sources.staleEnabled ?? 0) > 0
                        ? "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20"
                        : "border-zinc-200/70 dark:border-zinc-800/80"
                    }`}
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
                          ? new Date(data.ops.sources.lastFetchedAt).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </div>
                    </div>
                  </a>

                  <a
                    href="/agents"
                    className={`block rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                      Number(data.ops.agentRuns.failed24h ?? 0) > 0
                        ? "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20"
                        : "border-zinc-200/70 dark:border-zinc-800/80"
                    }`}
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
                          {data.ops.agentRuns.lastRun
                            ? `${data.ops.agentRuns.lastRun.agentKey} • ${data.ops.agentRuns.lastRun.status}`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        ),
      },
      {
        id: "risk_trend",
        title: "Risk trend",
        description: "Open residual exposure (last 14 days).",
        defaultContainer: "right",
        render: ({ projectSlug, riskAccess, data }) => (
          <Card className="shadow-sm dark:shadow-black/30">
            <CardHeader
              title="Risk trend"
              description="Open residual exposure (last 14 days)."
              border={false}
              right={
                <a
                  href={`/p/${projectSlug}/risk`}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
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
        ),
      },
      {
        id: "finding_mix",
        title: "Finding mix",
        description: "Severity breakdown.",
        defaultContainer: "right",
        render: ({ data }) => (
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
        ),
      },
      {
        id: "latest_findings",
        title: "Latest findings",
        description: "Most recent items across all agents.",
        defaultContainer: "left",
        render: ({ data }) => (
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
                  (data.latestFindings as FindingRow[]).map((f) => {
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
        ),
      },
      {
        id: "needs_attention",
        title: "Needs attention",
        description: "What to triage right now.",
        defaultContainer: "right",
        render: ({ projectSlug, riskAccess, data }) => (
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
                  className={`flex items-center justify-between gap-4 rounded-xl px-3 py-3 border transition-colors ${
                    !riskAccess
                      ? "border-zinc-200/60 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5"
                      : (data.attention.navigatorUnvalidated ?? 0) >= 250
                        ? "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-50/80 dark:hover:bg-rose-950/30"
                        : (data.attention.navigatorUnvalidated ?? 0) >= 100
                          ? "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50/80 dark:hover:bg-amber-950/30"
                          : "border-zinc-200/60 dark:border-zinc-800/60 hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
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
              </div>
            </CardContent>
          </Card>
        ),
      },
      {
        id: "sources",
        title: "Sources",
        description: "RSS + STIX feeds powering ingestion.",
        defaultContainer: "left",
        render: ({ data }) =>
          data.ops.sources.schemaReady ? (
            <SourceLogoStrip
              sources={data.ops.sources.all}
              wrap
              maxHeight={260}
              description={
                <span className="tabular-nums">
                  {nf(Number(data.ops.sources.total ?? 0))} total • {nf(Number(data.ops.sources.enabled ?? 0))} enabled •{" "}
                  {nf(Number(data.ops.sources.staleEnabled ?? 0))} stale (24h) • Last fetch:{" "}
                  {data.ops.sources.lastFetchedAt
                    ? new Date(data.ops.sources.lastFetchedAt).toLocaleString("en-US", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
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
          ),
      },
      // New widgets
      {
        id: "quick_links",
        title: "Quick links",
        description: "Jump to key pages and workflows.",
        defaultContainer: "right",
        render: ({ projectSlug, riskAccess }) => (
          <Card className="shadow-sm dark:shadow-black/30">
            <CardHeader title="Quick links" description="Jump to key pages and workflows." border={false} />
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="/findings"
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                >
                  Findings
                </a>
                <a
                  href="/agents"
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                >
                  Agents
                </a>
                <a
                  href="/data/sources"
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                >
                  Sources
                </a>
                <a
                  href={`/p/${projectSlug}/navigator?stage=validate&validation=needs_review`}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                >
                  Navigator
                </a>
                {riskAccess ? (
                  <a
                    href={`/p/${projectSlug}/risk`}
                    className="col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 px-3 py-2 text-sm hover:bg-indigo-600/15"
                  >
                    Risk management
                  </a>
                ) : (
                  <div
                    className="col-span-2 rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-100/40 dark:bg-zinc-900/30 px-3 py-2 text-sm text-zinc-500"
                    title="Available on Pro"
                  >
                    Risk management (Pro)
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ),
      },
      {
        id: "severity_snapshot",
        title: "Severity snapshot",
        description: "Counts by severity for the selected range.",
        defaultContainer: "right",
        render: ({ data }) => {
          const rows: Array<{ label: string; key: string; color: string; href: string }> = [
            { label: "Critical", key: "critical", color: "bg-rose-500", href: "/findings?band=critical" },
            { label: "High", key: "high", color: "bg-orange-500", href: "/findings?band=high" },
            { label: "Medium", key: "medium", color: "bg-amber-500", href: "/findings?band=medium" },
            { label: "Low", key: "low", color: "bg-emerald-500", href: "/findings?band=low" },
            { label: "Info", key: "info", color: "bg-sky-500", href: "/findings?band=unscored" },
            { label: "Unscored", key: "unscored", color: "bg-zinc-500", href: "/findings?band=unscored" },
          ];

          return (
            <Card className="shadow-sm dark:shadow-black/30">
              <CardHeader
                title="Severity snapshot"
                description={`${data.rangeLabel} counts by severity.`}
                border={false}
                right={
                  <a href="/findings" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    Open
                  </a>
                }
              />
              <CardContent className="pt-2">
                <div className="space-y-2">
                  {rows.map((r) => (
                    <a
                      key={r.key}
                      href={r.href}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <span className={clsx("h-2.5 w-2.5 rounded-full", r.color)} aria-hidden="true" />
                      <div className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-200">{r.label}</div>
                      <div className="tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {nf(Number(data.mix.severity[r.key] ?? 0))}
                      </div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        },
      },
      {
        id: "next_actions",
        title: "Next actions",
        description: "Suggested steps to improve coverage.",
        defaultContainer: "left",
        render: ({ ingestionHint, riskAccess, projectSlug, data }) => {
          const suggestions: Array<{ label: string; body: string; href: string }> = [];

          if (!data.kpis.agentsSchemaReady) {
            suggestions.push({ label: "Run DB migrations", body: "Enable dashboard metrics tables.", href: "/settings" });
          }
          if (Number(data.ops.sources.enabled ?? 0) === 0) {
            suggestions.push({ label: "Add sources", body: "Connect RSS/STIX feeds to start ingestion.", href: "/data/sources/new" });
          }
          if (Number(data.kpis.enabledAgents ?? 0) === 0) {
            suggestions.push({ label: "Enable agents", body: "Turn on agents to generate findings.", href: "/agents" });
          }
          if (riskAccess && (data.attention.navigatorUnvalidated ?? 0) > 0) {
            suggestions.push({
              label: "Triage Navigator backlog",
              body: "Review unvalidated scenarios to keep detections current.",
              href: `/p/${projectSlug}/navigator?stage=validate&validation=needs_review`,
            });
          }

          return (
            <Card className="shadow-sm dark:shadow-black/30">
              <CardHeader title="Next actions" description={ingestionHint} border={false} />
              <CardContent className="pt-2">
                {suggestions.length ? (
                  <div className="space-y-2">
                    {suggestions.slice(0, 4).map((s) => (
                      <a
                        key={s.label}
                        href={s.href}
                        className="block rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 bg-white/60 dark:bg-black/20 px-3 py-2.5 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
                      >
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.label}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">{s.body}</div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="py-2 text-sm text-zinc-500">Looking good. No immediate actions.</div>
                )}
              </CardContent>
            </Card>
          );
        },
      },
    ];

    const out: Record<string, WidgetDef> = {};
    for (const w of widgets) out[w.id] = w;
    return out;
  }, []);

  const allWidgets = useMemo(() => Object.values(registry), [registry]);

  const defaultLayout = useMemo(() => computeDefaultLayout(registry), [registry]);
  const [layout, setLayout] = useState<LayoutState>(defaultLayout);
  const [editing, setEditing] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<{ overId: string | null; overContainer: ContainerId | null; after: boolean } | null>(
    null
  );
  const [addTarget, setAddTarget] = useState<ContainerId | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const dragPayloadRef = useRef<{ id: string; from: ContainerId } | null>(null);

  useEffect(() => {
    const saved = safeParseLayout(typeof window !== "undefined" ? window.localStorage.getItem(storageKey(props.projectSlug)) : null);
    if (saved) setLayout((prev) => normalizeLayout(saved, registry, prev));
    setHasLoaded(true);
  }, [props.projectSlug, registry]);

  useEffect(() => {
    if (!hasLoaded) return;
    try {
      window.localStorage.setItem(storageKey(props.projectSlug), JSON.stringify(layout));
    } catch {
      // ignore
    }
  }, [hasLoaded, layout, props.projectSlug]);

  const used = useMemo(() => {
    const ids = new Set<string>();
    for (const id of layout.containers.left) ids.add(id);
    for (const id of layout.containers.right) ids.add(id);
    for (const id of layout.containers.footer) ids.add(id);
    return ids;
  }, [layout]);

  const availableWidgets = useMemo(() => allWidgets.filter((w) => !used.has(w.id)), [allWidgets, used]);

  const onRemove = (id: string) => {
    setLayout((cur) => {
      const next: LayoutState = {
        v: 1,
        containers: {
          left: [...cur.containers.left],
          right: [...cur.containers.right],
          footer: [...cur.containers.footer],
        },
      };
      next.containers.left = next.containers.left.filter((x) => x !== id);
      next.containers.right = next.containers.right.filter((x) => x !== id);
      next.containers.footer = next.containers.footer.filter((x) => x !== id);
      return next;
    });
  };

  const onAdd = (id: string, container: ContainerId) => {
    if (!registry[id]) return;
    setLayout((cur) => {
      const next: LayoutState = {
        v: 1,
        containers: {
          left: [...cur.containers.left],
          right: [...cur.containers.right],
          footer: [...cur.containers.footer],
        },
      };
      if (
        next.containers.left.includes(id) ||
        next.containers.right.includes(id) ||
        next.containers.footer.includes(id)
      ) {
        return cur;
      }
      next.containers[container].push(id);
      return next;
    });
  };

  const onReset = () => {
    setLayout(defaultLayout);
    try {
      window.localStorage.removeItem(storageKey(props.projectSlug));
    } catch {
      // ignore
    }
  };

  const startDrag = (id: string, from: ContainerId) => (e: React.DragEvent) => {
    if (!editing) return;
    dragPayloadRef.current = { id, from };
    setDraggingId(id);
    setDropOver(null);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    } catch {
      // ignore
    }
  };

  const endDrag = () => {
    dragPayloadRef.current = null;
    setDraggingId(null);
    setDropOver(null);
  };

  const handleDragOverItem = (container: ContainerId, overId: string) => (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropOver({ overId, overContainer: container, after });
  };

  const handleDragOverContainer = (container: ContainerId) => (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    setDropOver((prev) =>
      prev?.overContainer === container && prev?.overId == null ? prev : { overId: null, overContainer: container, after: false }
    );
  };

  const handleDrop = (container: ContainerId) => (e: React.DragEvent) => {
    if (!editing) return;
    e.preventDefault();
    const payload = dragPayloadRef.current;
    const activeId = payload?.id ?? draggingId;
    if (!activeId) {
      endDrag();
      return;
    }

    const overId = dropOver?.overContainer === container ? dropOver?.overId ?? null : null;
    const after = dropOver?.overContainer === container ? Boolean(dropOver?.after) : false;

    setLayout((cur) => moveItem({ layout: cur, activeId, overId, overContainer: container, overInsertAfter: after, registry }));
    endDrag();
  };

  const renderColumn = (container: ContainerId) => {
    const ids = layout.containers[container];
    return (
      <div className="flex flex-col gap-4" onDragOver={handleDragOverContainer(container)} onDrop={handleDrop(container)}>
        {ids.map((id) => {
          const w = registry[id];
          if (!w) return null;
          const dragging = draggingId === id;
          const over = dropOver?.overContainer === container && dropOver?.overId === id ? dropOver : null;

          return (
            <div key={id} className="relative">
              {editing && over ? (
                <div
                  className={clsx(
                    "absolute left-0 right-0 z-10 h-0.5 rounded-full bg-indigo-500/70",
                    over.after ? "-bottom-2" : "-top-2"
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <div onDragOver={handleDragOverItem(container, id)}>
                <WidgetShell
                  title={w.title}
                  editing={editing}
                  dragging={dragging}
                  onRemove={() => onRemove(id)}
                  onDragStart={startDrag(id, container)}
                  onDragEnd={endDrag}
                >
                  {w.render(ctx)}
                </WidgetShell>
              </div>
            </div>
          );
        })}

        {editing ? <AddWidgetTile onClick={() => setAddTarget(container)} disabled={!availableWidgets.length} /> : null}
      </div>
    );
  };

  return (
    <div className="mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Your dashboard</div>
        <div className="sm:ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={onReset}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
              >
                Reset layout
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  endDrag();
                }}
                className="rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-xs font-medium hover:opacity-95"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
            >
              Customize dashboard
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
          Drag cards to rearrange. Remove cards or add new widgets with the + tiles.
        </div>
      ) : null}

      {(() => {
        const showLeft = editing || layout.containers.left.length > 0;
        const showRight = editing || layout.containers.right.length > 0;
        const cols = showLeft && showRight ? "lg:grid-cols-2" : "lg:grid-cols-1";
        return (
          <div className={clsx("mt-4 grid grid-cols-1 gap-4 items-start", cols)}>
            {showLeft ? renderColumn("left") : null}
            {showRight ? renderColumn("right") : null}
          </div>
        );
      })()}

      {editing || layout.containers.footer.length ? (
        <div className="mt-4">
          {renderColumn("footer")}
        </div>
      ) : null}

      <WidgetPickerModal
        open={addTarget != null}
        onClose={() => setAddTarget(null)}
        widgets={availableWidgets}
        onPick={(id) => {
          const target = addTarget ?? "left";
          onAdd(id, target);
          setAddTarget(null);
        }}
      />
    </div>
  );
}
