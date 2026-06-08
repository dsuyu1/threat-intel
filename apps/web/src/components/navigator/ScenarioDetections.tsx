"use client";

import { useEffect, useMemo, useState } from "react";

type DetectionFormat = "sigma" | "kql" | "spl";
const FORMATS: DetectionFormat[] = ["sigma", "kql", "spl"];

type LifecycleStatus = "draft" | "peer_reviewed" | "deployed" | "monitoring" | "retired";
const LIFECYCLE: LifecycleStatus[] = ["draft", "peer_reviewed", "deployed", "monitoring", "retired"];

type DetectionRow = {
  id: string;
  format: DetectionFormat;
  content: string;
  updatedAt: string;
  model: string | null;
  lifecycleStatus: LifecycleStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  deployedAt: string | null;
  retiredAt: string | null;
};

type JobSummary = {
  status: "queued" | "running" | "succeeded" | "failed" | string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
} | null;

function prettyWhen(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString();
}

function formatLabel(f: DetectionFormat) {
  if (f === "spl") return "Splunk SPL";
  if (f === "kql") return "Sentinel KQL";
  return "Sigma";
}

function lifecycleLabel(s: LifecycleStatus) {
  if (s === "peer_reviewed") return "Peer-reviewed";
  if (s === "deployed") return "Deployed";
  if (s === "monitoring") return "Monitoring";
  if (s === "retired") return "Retired";
  return "Draft";
}

export function ScenarioDetections(props: { projectSlug: string; scenarioId: string; techniqueId: string }) {
  const [detections, setDetections] = useState<DetectionRow[]>([]);
  const [job, setJob] = useState<JobSummary>(null);
  const [active, setActive] = useState<DetectionFormat>("spl");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [earliestTime, setEarliestTime] = useState("-7d");
  const [latestTime, setLatestTime] = useState("now");

  const [deployEnabled, setDeployEnabled] = useState(true);
  const [deployScheduled, setDeployScheduled] = useState(false);
  const [deployCron, setDeployCron] = useState("0 * * * *");

  const [evalResult, setEvalResult] = useState<{ matchCount: number; matchesPerDay: number; windowDaysEstimated: number | null } | null>(
    null
  );
  const [deployResult, setDeployResult] = useState<{ name: string; created: boolean; owner: string; app: string } | null>(null);

  const byFormat = useMemo(() => {
    const map: Partial<Record<DetectionFormat, DetectionRow>> = {};
    for (const d of detections) {
      if (!map[d.format] || new Date(d.updatedAt).getTime() > new Date(map[d.format]!.updatedAt).getTime()) map[d.format] = d;
    }
    return map;
  }, [detections]);

  const hasAny = FORMATS.some((f) => Boolean(byFormat[f]?.content));
  const hasAll = FORMATS.every((f) => Boolean(byFormat[f]?.content));
  const isQueued = job?.status === "queued" || job?.status === "running";

  const refresh = async () => {
    const res = await fetch(
      `/api/navigator/detections?scenarioId=${encodeURIComponent(props.scenarioId)}&techniqueId=${encodeURIComponent(
        props.techniqueId
      )}`,
      { headers: { "x-ti-project-slug": props.projectSlug } }
    );
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(String(data?.error ?? "Failed to load detections"));
    setDetections(Array.isArray(data?.detections) ? data.detections : []);
    setJob((data?.job ?? null) as JobSummary);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scenarioId, props.techniqueId]);

  const queueAndRun = async (formats: DetectionFormat[]) => {
    setBusy(true);
    setError(null);
    setEvalResult(null);
    setDeployResult(null);
    try {
      const queued = await fetch("/api/navigator/detections/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ scenarioId: props.scenarioId, techniqueId: props.techniqueId, formats }),
      });
      const q = (await queued.json().catch(() => null)) as any;
      if (!queued.ok) throw new Error(String(q?.error ?? "Failed to queue detection job"));

      // Best-effort: in local/self-hosted, kick off the agent immediately.
      await fetch("/api/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ kind: "system", agentKey: "detections", scenarioId: props.scenarioId }),
      }).catch(() => null);

      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onEvaluate = async () => {
    setBusy(true);
    setError(null);
    setEvalResult(null);
    try {
      const res = await fetch("/api/navigator/detections/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          scenarioId: props.scenarioId,
          techniqueId: props.techniqueId,
          earliestTime,
          latestTime,
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? "Splunk evaluate failed"));
      setEvalResult({
        matchCount: Number(data?.matchCount ?? 0),
        matchesPerDay: Number(data?.matchesPerDay ?? 0),
        windowDaysEstimated: data?.windowDaysEstimated == null ? null : Number(data.windowDaysEstimated),
      });
    } finally {
      setBusy(false);
    }
  };

  const onDeploy = async () => {
    setBusy(true);
    setError(null);
    setDeployResult(null);
    try {
      const res = await fetch("/api/navigator/detections/deploy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          scenarioId: props.scenarioId,
          techniqueId: props.techniqueId,
          options: {
            enabled: deployEnabled,
            isScheduled: deployScheduled,
            cronSchedule: deployScheduled ? deployCron : "",
            earliestTime: earliestTime || "",
            latestTime: latestTime || "",
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? "Splunk deploy failed"));
      const s = data?.savedSearch ?? null;
      setDeployResult(
        s
          ? {
              name: String(s.name ?? ""),
              created: Boolean(s.created),
              owner: String(s.owner ?? ""),
              app: String(s.app ?? ""),
            }
          : null
      );
    } finally {
      setBusy(false);
    }
  };

  const activeRow = byFormat[active] ?? null;
  const lifecycle = activeRow?.lifecycleStatus ?? "draft";

  const updateLifecycle = async (next: LifecycleStatus) => {
    if (!activeRow?.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/navigator/detections/${encodeURIComponent(activeRow.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ lifecycleStatus: next }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? "Failed to update lifecycle status"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Detections</h2>
          <div className="mt-2 text-xs text-zinc-500">
            {isQueued ? (
              <span>
                Status: {job?.status} (updated {prettyWhen(job?.updatedAt) ?? "recently"})
              </span>
            ) : hasAll ? (
              <span>Status: generated (updated {prettyWhen(activeRow?.updatedAt) ?? "recently"})</span>
            ) : hasAny ? (
              <span>Status: partially generated</span>
            ) : (
              <span>Status: not generated</span>
            )}
            {job?.status === "failed" && job.error ? <span className="ml-2 text-rose-600 dark:text-rose-400">({job.error})</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            onClick={() => queueAndRun(FORMATS)}
            disabled={busy || isQueued}
          >
            {hasAny ? "Regenerate" : "Generate now"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FORMATS.map((f) => (
          <button
            key={f}
            className={
              "rounded-lg px-3 py-1.5 text-sm border " +
              (active === f
                ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 hover:bg-white dark:hover:bg-black/40")
            }
            onClick={() => setActive(f)}
            disabled={busy}
          >
            {formatLabel(f)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-500">
            {activeRow?.updatedAt ? <span>Updated {prettyWhen(activeRow.updatedAt)}</span> : <span>Not generated</span>}
            {activeRow?.model ? <span className="ml-2">({activeRow.model})</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              value={lifecycle}
              disabled={busy || !activeRow?.content}
              onChange={(e) => updateLifecycle(e.target.value as LifecycleStatus)}
              title="Detection lifecycle"
            >
              {LIFECYCLE.map((s) => (
                <option key={s} value={s}>
                  {lifecycleLabel(s)}
                </option>
              ))}
            </select>
            <button
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
              disabled={busy || !activeRow?.content}
              onClick={async () => {
                if (!activeRow?.content) return;
                await navigator.clipboard.writeText(activeRow.content);
              }}
            >
              Copy
            </button>
          </div>
        </div>

        {activeRow?.content ? (
          <div className="mt-2 text-xs text-zinc-500">
            Lifecycle: <span className="font-medium text-zinc-700 dark:text-zinc-200">{lifecycleLabel(lifecycle)}</span>
            {activeRow.reviewedAt ? <span className="ml-2">Reviewed {prettyWhen(activeRow.reviewedAt)}</span> : null}
            {activeRow.deployedAt ? <span className="ml-2">Deployed {prettyWhen(activeRow.deployedAt)}</span> : null}
            {activeRow.retiredAt ? <span className="ml-2">Retired {prettyWhen(activeRow.retiredAt)}</span> : null}
          </div>
        ) : null}

        <pre className="mt-3 max-h-[340px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-black/5 dark:bg-black/40 p-3 text-xs text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
          {activeRow?.content ? activeRow.content : "No cached detection for this format yet."}
        </pre>
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3">
        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Splunk</div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Earliest time
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
              value={earliestTime}
              onChange={(e) => setEarliestTime(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Latest time
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
              value={latestTime}
              onChange={(e) => setLatestTime(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm font-medium hover:opacity-95 disabled:opacity-60"
            onClick={onEvaluate}
            disabled={busy || !byFormat.spl?.content}
          >
            Evaluate in Splunk
          </button>
          <button
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            onClick={onDeploy}
            disabled={busy || !byFormat.spl?.content}
          >
            Deploy to Splunk
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
            <input type="checkbox" checked={deployEnabled} onChange={(e) => setDeployEnabled(e.target.checked)} disabled={busy} />
            Enabled
          </label>
          <label className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
            <input type="checkbox" checked={deployScheduled} onChange={(e) => setDeployScheduled(e.target.checked)} disabled={busy} />
            Scheduled
          </label>
          {deployScheduled ? (
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              Cron schedule
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                value={deployCron}
                onChange={(e) => setDeployCron(e.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}
        </div>

        {evalResult ? (
          <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            Matches: <span className="tabular-nums">{evalResult.matchCount}</span> | Per day (est.):{" "}
            <span className="tabular-nums">{evalResult.matchesPerDay.toFixed(2)}</span>
            {evalResult.windowDaysEstimated != null ? (
              <span className="ml-2">(window {evalResult.windowDaysEstimated.toFixed(2)} days)</span>
            ) : null}
          </div>
        ) : null}

        {deployResult ? (
          <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            Saved search: <span className="font-medium">{deployResult.name}</span> ({deployResult.created ? "created" : "updated"}) in{" "}
            {deployResult.owner}/{deployResult.app}
          </div>
        ) : null}

        {error ? <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}
      </div>
    </section>
  );
}
