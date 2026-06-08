"use client";

import { useMemo, useState } from "react";
import { DualLineChart } from "./charts";
import { Card, CardContent, CardHeader } from "../ui/Card";

type TrendPoint = { label: string; value: number };

type BreakdownRow = {
  incidentType: string;
  count: number;
  meanMinutes: number;
};

type MetricSeries = {
  current: TrendPoint[];
  previous: TrendPoint[];
  changePct: number | null;
  meanMinutes: number | null;
  byType: BreakdownRow[];
};

type Effectiveness = {
  avgScore: number | null;
  reviewCount: number;
  topSkippedSteps: Array<{ label: string; count: number }>;
  topFailedActions: Array<{ label: string; count: number }>;
};

function fmtDuration(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "\u2014";
  const m = Math.max(0, Math.round(minutes));
  if (m < 90) return `${m}m`;
  const hours = Math.round((m / 60) * 10) / 10;
  if (hours < 72) return `${hours}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

function labelForIncidentType(v: string) {
  const s = String(v ?? "").trim();
  if (!s || s === "null" || s === "undefined") return "untyped";
  if (s === "vulnerability_exploitation") return "Vuln exploitation";
  if (s === "credential_compromise") return "Credential compromise";
  if (s === "ransomware") return "Ransomware";
  if (s === "supply_chain") return "Supply chain";
  if (s === "lateral_movement") return "Lateral movement";
  if (s === "data_exfiltration") return "Data exfiltration";
  return s;
}

function pctLabel(pct: number | null) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const n = Math.round(pct);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

export function IncidentMetricsCard(props: {
  schemaReady: boolean;
  rangeLabel: string;
  metrics: { mttd: MetricSeries; mttr: MetricSeries; mtc: MetricSeries };
  effectiveness: Effectiveness | null;
}) {
  const [metric, setMetric] = useState<"mttd" | "mttr" | "mtc">("mttr");

  const active = props.metrics[metric];
  const hasAnyData = useMemo(() => {
    const vals = active.current.map((x) => Number(x.value ?? 0));
    return vals.some((v) => v > 0);
  }, [active.current]);

  const tabs: Array<{ id: "mttd" | "mttr" | "mtc"; label: string }> = [
    { id: "mttd", label: "MTTD" },
    { id: "mttr", label: "MTTR" },
    { id: "mtc", label: "Contain" },
  ];

  const score = props.effectiveness?.avgScore ?? null;
  const scoreLabel = typeof score === "number" && Number.isFinite(score) ? `${Math.round(score)}/100` : "\u2014";

  return (
    <Card className="shadow-sm dark:shadow-black/30">
      <CardHeader
        title="Incident response"
        description={`${props.rangeLabel} mean durations (current vs previous).`}
        border={false}
        right={
          <div className="text-right">
            <div className="text-[11px] text-zinc-500">Playbook effectiveness</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {scoreLabel}
            </div>
          </div>
        }
      />
      <CardContent className="pt-2">
        {!props.schemaReady ? (
          <div className="py-4 text-sm text-zinc-500">
            Incident metrics tables are missing. Run <span className="font-mono">pnpm db:migrate</span>.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-1">
                {tabs.map((t) => {
                  const activeTab = t.id === metric;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMetric(t.id)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                        activeTab
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="text-xs text-zinc-500">
                Mean:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100 font-medium">
                  {fmtDuration(active.meanMinutes)}
                </span>
                {pctLabel(active.changePct) ? (
                  <span className="ml-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                    ({pctLabel(active.changePct)})
                  </span>
                ) : null}
              </div>
            </div>

            {hasAnyData ? (
              <DualLineChart primary={active.current} secondary={active.previous} height={170} />
            ) : (
              <div className="py-4 text-sm text-zinc-500">
                No incident timing data yet for this range.
              </div>
            )}

            {active.byType.length ? (
              <div className="pt-1">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">By incident type</div>
                <div className="mt-2 space-y-2">
                  {active.byType.map((r) => (
                    <div key={r.incidentType} className="flex items-center gap-3 text-sm">
                      <div className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                        {labelForIncidentType(r.incidentType)}
                      </div>
                      <div className="tabular-nums text-xs text-zinc-500">{r.count}</div>
                      <div className="tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
                        {fmtDuration(r.meanMinutes)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {props.effectiveness ? (
              <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/80">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Post-incident reviews</div>
                  <div className="text-[11px] text-zinc-500 tabular-nums">
                    {props.effectiveness.reviewCount} in range
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3">
                  {props.effectiveness.topSkippedSteps.length ? (
                    <div>
                      <div className="text-[11px] text-zinc-500">Top skipped steps</div>
                      <div className="mt-1 space-y-1">
                        {props.effectiveness.topSkippedSteps.map((x) => (
                          <div key={x.label} className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                            <div className="min-w-0 flex-1 truncate">{x.label}</div>
                            <div className="tabular-nums">{x.count}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {props.effectiveness.topFailedActions.length ? (
                    <div>
                      <div className="text-[11px] text-zinc-500">Top failed tool actions</div>
                      <div className="mt-1 space-y-1">
                        {props.effectiveness.topFailedActions.map((x) => (
                          <div key={x.label} className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                            <div className="min-w-0 flex-1 truncate">{x.label}</div>
                            <div className="tabular-nums">{x.count}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

