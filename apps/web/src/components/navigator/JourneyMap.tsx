"use client";

import { useEffect, useMemo, useState } from "react";
import { TtpFlowCanvas, type TtpFlowEdge } from "../TtpFlowCanvas";

type Group = {
  tactic: string;
  items: Array<{ id: string; name: string; highlight?: boolean }>;
};

type DetectionFormat = "sigma" | "kql" | "spl";

type DetectionState = {
  content: string;
  updatedAt?: string | null;
  model?: string | null;
};

const FORMAT_TABS: Array<{ id: DetectionFormat; label: string; subtitle: string }> = [
  { id: "sigma", label: "Sigma", subtitle: "Cross-SIEM detection rule (YAML)" },
  { id: "kql", label: "Sentinel KQL", subtitle: "Microsoft Sentinel query" },
  { id: "spl", label: "Splunk SPL", subtitle: "Splunk search query" },
];

const SPLUNK_DEPLOY_DEFAULTS = {
  connectionId: "",
  name: "",
  enabled: true,
  isScheduled: false,
  cronSchedule: "0 * * * *",
  earliestTime: "-24h@h",
  latestTime: "now",
  additionalParamsText: "",
};

function slugifyDomId(input: string) {
  return String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nodeId(tactic: string, techniqueId: string) {
  return `journey-${slugifyDomId(tactic)}-${slugifyDomId(techniqueId)}`;
}

function emptyDetections(): Record<DetectionFormat, DetectionState | null> {
  return { sigma: null, kql: null, spl: null };
}

function formatLabel(id: DetectionFormat) {
  return FORMAT_TABS.find((t) => t.id === id)?.label ?? id;
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function stripCodeFences(input: string) {
  const s = String(input ?? "").trim();
  const m = s.match(/^```[a-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? s).trim();
}

function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idxEq = line.indexOf("=");
    const idxColon = line.indexOf(":");
    const idx = idxEq >= 0 ? idxEq : idxColon;
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k || !v) continue;
    out[k] = v;
  }
  return out;
}

export function JourneyMap({
  groups,
  scenarioId,
  projectSlug,
}: {
  groups: Group[];
  scenarioId: string;
  projectSlug: string;
}) {
  const edges: TtpFlowEdge[] = [];
  const [selected, setSelected] = useState<{ tactic: string; id: string; name: string } | null>(null);
  const [activeFormat, setActiveFormat] = useState<DetectionFormat>("sigma");
  const [detections, setDetections] = useState<Record<DetectionFormat, DetectionState | null>>(() => emptyDetections());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<DetectionFormat | null>(null);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [pushingSplunk, setPushingSplunk] = useState(false);
  const [splunkDeploy, setSplunkDeploy] = useState(() => ({ ...SPLUNK_DEPLOY_DEFAULTS }));
  const [splunkTargets, setSplunkTargets] = useState<Array<{ id: string; name: string; enabled: boolean; baseUrl: string }>>([]);
  const [splunkTargetsLoading, setSplunkTargetsLoading] = useState(false);

  const selectedId = selected?.id ?? "";
  const selectedName = selected?.name ?? "";
  const activeContent = detections[activeFormat]?.content ?? "";

  // Connect the first node of each tactic column to the next column.
  for (let i = 0; i < groups.length - 1; i++) {
    const a = groups[i]!;
    const b = groups[i + 1]!;
    const from = a.items[0]?.id ? nodeId(a.tactic, a.items[0].id) : null;
    const to = b.items[0]?.id ? nodeId(b.tactic, b.items[0].id) : null;
    if (from && to) edges.push({ from, to, kind: "right" });
  }

  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setNotice("");
    setCopied(false);
    setPushingSplunk(false);
    setSplunkDeploy({ ...SPLUNK_DEPLOY_DEFAULTS });
    setDetections(emptyDetections());

    const url = new URL("/api/navigator/detections", window.location.origin);
    url.searchParams.set("scenarioId", scenarioId);
    url.searchParams.set("techniqueId", selectedId);

    (async () => {
      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: { "x-ti-project-slug": projectSlug },
        });
        const data = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(String(data?.error ?? `Failed to load detections (${res.status})`));
        }

        const next = emptyDetections();
        const rows = Array.isArray(data?.detections) ? data.detections : [];
        for (const r of rows) {
          const fmt = String(r?.format ?? "").toLowerCase();
          if (fmt !== "sigma" && fmt !== "kql" && fmt !== "spl") continue;
          const content = String(r?.content ?? "");
          if (!content) continue;
          next[fmt as DetectionFormat] = {
            content,
            updatedAt: r?.updatedAt ? String(r.updatedAt) : null,
            model: r?.model ? String(r.model) : null,
          };
        }
        setDetections(next);
      } catch (e) {
        if (!cancelled) setError(safeErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, scenarioId, projectSlug]);

  useEffect(() => {
    if (!selectedId) return;
    if (activeFormat !== "spl") return;

    let cancelled = false;
    setSplunkTargetsLoading(true);

    (async () => {
      try {
        const res = await fetch("/api/integrations/splunk", {
          method: "GET",
          headers: { "x-ti-project-slug": projectSlug },
        });
        const data = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        if (!res.ok) throw new Error(String(data?.error ?? `Failed to load Splunk connections (${res.status})`));

        const rows = Array.isArray(data?.data) ? data.data : [];
        const parsed = rows
          .map((r: any) => ({
            id: String(r?.id ?? "").trim(),
            name: String(r?.name ?? "").trim() || "Splunk",
            enabled: Boolean(r?.enabled),
            baseUrl: String(r?.baseUrl ?? "").trim(),
          }))
          .filter((r: any) => r.id);

        setSplunkTargets(parsed);
      } catch {
        if (!cancelled) setSplunkTargets([]);
      } finally {
        if (!cancelled) setSplunkTargetsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, activeFormat, projectSlug]);

  useEffect(() => {
    if (!selectedId) return;
    if (loading) return;
    if (detections.sigma?.content) return;

    // "One click": opening a TTP auto-generates Sigma if missing.
    void (async () => {
      setGenerating("sigma");
      setError("");
      try {
        const res = await fetch("/api/navigator/detections", {
          method: "POST",
          headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
          body: JSON.stringify({
            scenarioId,
            techniqueId: selectedId,
            techniqueName: selectedName,
            format: "sigma",
          }),
        });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(String(data?.error ?? `Failed to generate (${res.status})`));
        const content = stripCodeFences(String(data?.content ?? ""));
        setDetections((prev) => ({
          ...prev,
          sigma: { content, updatedAt: data?.updatedAt ? String(data.updatedAt) : null, model: data?.model ?? null },
        }));
      } catch (e) {
        setError(safeErrorMessage(e));
      } finally {
        setGenerating(null);
      }
    })();
  }, [selectedId, selectedName, loading, detections.sigma?.content, scenarioId, projectSlug]);

  const canClose = generating === null;

  const generateFor = async (format: DetectionFormat, regenerate: boolean) => {
    if (!selected) return;
    setGenerating(format);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/navigator/detections", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
        body: JSON.stringify({
          scenarioId,
          techniqueId: selected.id,
          techniqueName: selected.name,
          format,
          regenerate,
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Failed to generate (${res.status})`));
      const content = stripCodeFences(String(data?.content ?? ""));
      setDetections((prev) => ({
        ...prev,
        [format]: { content, updatedAt: data?.updatedAt ? String(data.updatedAt) : null, model: data?.model ?? null },
      }));
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setGenerating(null);
    }
  };

  const copyActive = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      setError(`Copy failed: ${safeErrorMessage(e)}`);
    }
  };

  const pushToSplunk = async () => {
    if (!selected) return;
    if (activeFormat !== "spl") return;
    if (!activeContent.trim()) return;

    if (splunkDeploy.isScheduled && !splunkDeploy.cronSchedule.trim()) {
      setError("Cron schedule is required when Scheduled is enabled.");
      return;
    }

    setPushingSplunk(true);
    setError("");
    setNotice("");
    try {
      const additionalParams = parseKeyValueLines(splunkDeploy.additionalParamsText);
      const res = await fetch("/api/integrations/splunk/push", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
        body: JSON.stringify({
          scenarioId,
          techniqueId: selected.id,
          techniqueName: selected.name,
          content: activeContent,
          connectionId: splunkDeploy.connectionId.trim() || undefined,
          options: {
            name: splunkDeploy.name.trim() || undefined,
            enabled: splunkDeploy.enabled,
            isScheduled: splunkDeploy.isScheduled,
            cronSchedule: splunkDeploy.cronSchedule.trim() || undefined,
            earliestTime: splunkDeploy.earliestTime.trim() || undefined,
            latestTime: splunkDeploy.latestTime.trim() || undefined,
            additionalParams: Object.keys(additionalParams).length ? additionalParams : undefined,
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Failed to push (${res.status})`));
      const ss = data?.savedSearch ?? null;
      const verb = ss?.created ? "Created" : "Updated";
      const conn = ss?.connectionName ? ` (${String(ss.connectionName)})` : "";
      setNotice(`${verb} Splunk saved search${conn}: ${String(ss?.name ?? "") || "OK"}`);
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setPushingSplunk(false);
    }
  };

  const createAction = async () => {
    if (!selected) return;
    setError("");
    try {
      const res = await fetch("/api/navigator/actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
        body: JSON.stringify({
          scenarioId,
          title: `Validate ${formatLabel(activeFormat)} detection for ${selected.id}`,
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Failed to create action (${res.status})`));
    } catch (e) {
      setError(safeErrorMessage(e));
    }
  };

  const subtitle = useMemo(() => {
    const tab = FORMAT_TABS.find((t) => t.id === activeFormat);
    return tab?.subtitle ?? "";
  }, [activeFormat]);

  return (
    <div className="overflow-x-auto pb-2">
      <TtpFlowCanvas edges={edges}>
        <div className="grid grid-flow-col auto-cols-[minmax(260px,260px)] gap-4">
          {groups.map((g) => (
            <div key={g.tactic} className="min-w-[260px] max-w-[260px]">
              <div className="flex items-baseline justify-between">
                <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                  {g.tactic}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">{g.items.length}</div>
              </div>

              <div className="mt-2 space-y-3">
                {g.items.slice(0, 12).map((it) => (
                  <button
                    key={it.id}
                    id={nodeId(g.tactic, it.id)}
                    type="button"
                    onClick={() => {
                      setSelected({ tactic: g.tactic, id: it.id, name: it.name });
                      setActiveFormat("sigma");
                    }}
                    className={`w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                      it.highlight
                        ? "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/60 dark:bg-sky-950/20"
                        : "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20"
                    } hover:bg-white/70 dark:hover:bg-black/30`}
                  >
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {it.name}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{it.id}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TtpFlowCanvas>

      {selected ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close"
            disabled={!canClose}
            onClick={() => {
              if (!canClose) return;
              setSelected(null);
            }}
          />

          <div className="absolute left-1/2 top-16 w-[min(980px,calc(100vw-24px))] -translate-x-1/2">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl shadow-black/20 dark:shadow-black/60">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                    Detection output
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {selected.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                      {selected.id}
                    </span>
                    <span className="rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5">{selected.tactic}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{subtitle}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                  disabled={!canClose}
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {FORMAT_TABS.map((t) => {
                    const active = t.id === activeFormat;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveFormat(t.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? "border-blue-600/60 bg-blue-950/10 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200"
                            : "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={copyActive}
                      disabled={!activeContent || loading || generating !== null || pushingSplunk}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>

                    {activeFormat === "spl" ? (
                      <button
                        type="button"
                        onClick={pushToSplunk}
                        disabled={!activeContent.trim() || loading || generating !== null || pushingSplunk}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                      >
                        {pushingSplunk ? "Pushing..." : "Push to Splunk"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => generateFor(activeFormat, false)}
                      disabled={loading || generating !== null || pushingSplunk}
                      className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {generating === activeFormat ? "Generating…" : detections[activeFormat]?.content ? "Refresh" : "Generate"}
                    </button>

                    <button
                      type="button"
                      onClick={() => generateFor(activeFormat, true)}
                      disabled={loading || generating !== null || pushingSplunk}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      Regenerate
                    </button>

                    <button
                      type="button"
                      onClick={createAction}
                      disabled={loading || generating !== null || pushingSplunk}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      Add to actions
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                    {error}
                  </div>
                ) : null}

                {notice ? (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                    {notice}
                  </div>
                ) : null}

                {activeFormat === "spl" ? (
                  <details className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20">
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      Deployment options
                    </summary>
                    <div className="px-3 pb-3 pt-1 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1 md:col-span-2">
                          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Connection</div>
                          <select
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono disabled:opacity-60"
                            value={splunkDeploy.connectionId}
                            disabled={splunkTargetsLoading}
                            onChange={(e) => setSplunkDeploy((p) => ({ ...p, connectionId: e.target.value }))}
                          >
                            <option value="">{splunkTargetsLoading ? "Loading..." : "Auto (latest enabled)"}</option>
                            {splunkTargets.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.enabled ? "" : "[disabled] "}
                                {c.name}
                                {c.baseUrl ? ` - ${c.baseUrl}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Saved search name</div>
                          <input
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono"
                            value={splunkDeploy.name}
                            onChange={(e) => setSplunkDeploy((p) => ({ ...p, name: e.target.value }))}
                            placeholder="(auto)"
                          />
                        </label>

                        <div className="flex items-center gap-4 pt-5">
                          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                            <input
                              type="checkbox"
                              checked={splunkDeploy.enabled}
                              onChange={(e) => setSplunkDeploy((p) => ({ ...p, enabled: e.target.checked }))}
                            />
                            Enabled
                          </label>

                          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                            <input
                              type="checkbox"
                              checked={splunkDeploy.isScheduled}
                              onChange={(e) => setSplunkDeploy((p) => ({ ...p, isScheduled: e.target.checked }))}
                            />
                            Scheduled
                          </label>
                        </div>

                        <label className="space-y-1">
                          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Cron schedule</div>
                          <input
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono disabled:opacity-60"
                            value={splunkDeploy.cronSchedule}
                            disabled={!splunkDeploy.isScheduled}
                            onChange={(e) => setSplunkDeploy((p) => ({ ...p, cronSchedule: e.target.value }))}
                            placeholder="0 * * * *"
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="space-y-1">
                            <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Earliest</div>
                            <input
                              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono"
                              value={splunkDeploy.earliestTime}
                              onChange={(e) => setSplunkDeploy((p) => ({ ...p, earliestTime: e.target.value }))}
                              placeholder="-24h@h"
                            />
                          </label>
                          <label className="space-y-1">
                            <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Latest</div>
                            <input
                              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono"
                              value={splunkDeploy.latestTime}
                              onChange={(e) => setSplunkDeploy((p) => ({ ...p, latestTime: e.target.value }))}
                              placeholder="now"
                            />
                          </label>
                        </div>

                        <label className="space-y-1 md:col-span-2">
                          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            Advanced params (optional)
                          </div>
                          <textarea
                            className="w-full min-h-[84px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-xs font-mono"
                            value={splunkDeploy.additionalParamsText}
                            onChange={(e) => setSplunkDeploy((p) => ({ ...p, additionalParamsText: e.target.value }))}
                            placeholder={`alert_type=number of results\nalert_comparator=greater than\nalert_threshold=0`}
                          />
                        </label>
                      </div>

                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Tip: earliest/latest supports Splunk time modifiers (e.g. <span className="font-mono">-60m@m</span>,{" "}
                        <span className="font-mono">-24h@h</span>, <span className="font-mono">now</span>). Manage connections in{" "}
                        <a className="underline hover:opacity-90" href="/integrations/splunk">
                          Connections -&gt; Splunk
                        </a>
                        .
                      </div>
                    </div>
                  </details>
                ) : null}

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20">
                  <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {loading ? "Loading…" : generating ? "Generating…" : detections[activeFormat]?.updatedAt ? `Updated ${new Date(detections[activeFormat]!.updatedAt as any).toLocaleString()}` : "Not generated yet"}
                    </div>
                    <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {detections[activeFormat]?.model ? String(detections[activeFormat]!.model) : ""}
                    </div>
                  </div>
                  <pre className="max-h-[60vh] overflow-auto p-3 text-xs leading-relaxed text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap font-mono">
                    {activeContent || (loading ? "" : "—")}
                  </pre>
                </div>

                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Generated detections are starting points. Validate against your telemetry, CIM mappings, and alerting thresholds.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
