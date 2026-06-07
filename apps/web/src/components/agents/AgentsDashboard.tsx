"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type RunRow = {
  id: string;
  agentKey: string;
  kind: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  customAgentId: string | null;
  metrics: any;
};

type SystemAgent = {
  key: string;
  title: string;
  short: string;
  produces?: string;
  enabled: boolean;
  lastRun: RunRow | null;
};

type CustomAgent = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
  lastRun: RunRow | null;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function badge(status: string) {
  const s = status.toLowerCase();
  const cls =
    s === "succeeded"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
      : s === "failed"
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20"
        : s === "skipped"
          ? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20"
          : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20";
  return { cls, label: s };
}

export function AgentsDashboard(props: {
  systemAgents: SystemAgent[];
  customAgents: CustomAgent[];
  recentRuns: RunRow[];
  viewerTier: string;
  aiKey: {
    configured: boolean;
    provider: string | null;
    baseUrl: string | null;
    updatedAt: string | null;
    error?: string | null;
  };
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(props.aiKey.baseUrl ?? "");
  const [keyStatus, setKeyStatus] = useState<string | null>(props.aiKey.error ?? null);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  const systemEnabledCount = useMemo(
    () => props.systemAgents.filter((a) => a.enabled).length,
    [props.systemAgents]
  );

  const toggleSystem = async (agentKey: string, enabled: boolean) => {
    setBusyKey(`sys:${agentKey}`);
    try {
      const res = await fetch("/api/agents/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentKey, enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
    } finally {
      setBusyKey("");
    }
  };

  const toggleCustom = async (id: string, enabled: boolean) => {
    setBusyKey(`custom:${id}`);
    try {
      const res = await fetch(`/api/agents/custom/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
    } finally {
      setBusyKey("");
    }
  };

  const deleteCustom = async (id: string) => {
    if (!confirm("Delete this agent?")) return;
    setBusyKey(`custom-del:${id}`);
    try {
      const res = await fetch(`/api/agents/custom/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
    } finally {
      setBusyKey("");
    }
  };

  const runSystemNow = async (agentKey: string) => {
    setBusyKey(`run:sys:${agentKey}`);
    setRunStatus(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "system", agentKey }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setRunStatus("Run started. Refreshingâ€¦");
      router.refresh();
    } catch (err) {
      setRunStatus(String((err as any)?.message ?? err));
    } finally {
      setBusyKey("");
    }
  };

  const runCustomNow = async (customAgentId: string) => {
    setBusyKey(`run:custom:${customAgentId}`);
    setRunStatus(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "custom", customAgentId }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setRunStatus("Run started. Refreshingâ€¦");
      router.refresh();
    } catch (err) {
      setRunStatus(String((err as any)?.message ?? err));
    } finally {
      setBusyKey("");
    }
  };

  const saveAiKey = async () => {
    setBusyKey("ai-key:save");
    setKeyStatus(null);
    try {
      const res = await fetch("/api/agents/ai-key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setApiKey("");
      setKeyStatus("Saved.");
      router.refresh();
    } catch (err) {
      setKeyStatus(String((err as any)?.message ?? err));
    } finally {
      setBusyKey("");
    }
  };

  const clearAiKey = async () => {
    if (!confirm("Remove your stored API key?")) return;
    setBusyKey("ai-key:clear");
    setKeyStatus(null);
    try {
      const res = await fetch("/api/agents/ai-key?provider=openai", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setApiKey("");
      setKeyStatus("Removed.");
      router.refresh();
    } catch (err) {
      setKeyStatus(String((err as any)?.message ?? err));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agents</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Enable/disable system agents, build your own, and review runs and output.
            </p>
          </div>
          <a
            href="/agents/new"
            className="shrink-0 inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
          >
            Create agent
          </a>
        </div>
      </header>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your API key</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Used to run your custom agents with your own OpenAI-compatible key.
              {props.viewerTier !== "pro" ? " On Free, this is required to run custom agents." : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Status:{" "}
              {props.aiKey.configured ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  configured
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-300">
                  not set
                </span>
              )}
            </div>
            {props.aiKey.updatedAt ? (
              <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">updated {fmtWhen(props.aiKey.updatedAt)}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block md:col-span-2">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">OpenAI API key</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={props.aiKey.configured ? "Enter a new key to rotate" : "sk-..."}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              disabled={busyKey.startsWith("ai-key:")}
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Base URL (optional)</div>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              disabled={busyKey.startsWith("ai-key:")}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            {keyStatus ? <div className="text-xs text-zinc-600 dark:text-zinc-400">{keyStatus}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveAiKey()}
              disabled={busyKey !== "" || !apiKey.trim()}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-1.5 text-xs hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              {busyKey === "ai-key:save" ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void clearAiKey()}
              disabled={busyKey !== "" || !props.aiKey.configured}
              className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 disabled:opacity-60"
            >
              {busyKey === "ai-key:clear" ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-zinc-500">
          Keys are stored encrypted in the database and are only used by background agent workers.
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">System agents</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {systemEnabledCount} enabled
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-4 text-left font-medium">Status</th>
                <th className="py-2 pr-4 text-left font-medium">Agent</th>
                <th className="py-2 pr-4 text-left font-medium">Last run</th>
                <th className="py-2 pr-4 text-left font-medium">Status</th>
                <th className="py-2 pr-4 text-left font-medium">Output</th>
                <th className="py-2 pr-4 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {props.systemAgents.map((a) => {
                const r = a.lastRun;
                const b = r ? badge(r.status) : null;
                return (
                  <tr key={a.key} className="align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSystem(a.key, !a.enabled)}
                        disabled={busyKey === `sys:${a.key}`}
                        aria-pressed={a.enabled}
                        className={`inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-white dark:hover:bg-black/40 disabled:opacity-60 ${
                          a.enabled
                            ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                            : "border-zinc-500/30 text-zinc-700 dark:text-zinc-300 bg-zinc-500/10"
                        }`}
                      >
                        {busyKey === `sys:${a.key}` ? "Saving..." : a.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="py-3 pr-4 min-w-[240px]">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{a.title}</div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{a.short}</div>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {fmtWhen(r?.finishedAt ?? r?.startedAt ?? null)}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {b ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${b.cls}`}>
                          {b.label}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400 min-w-[220px]">
                      {a.produces ?? "—"}
                      {r?.metrics ? (
                        <div className="mt-1 text-[11px] text-zinc-500">
                          {Object.entries(r.metrics)
                            .slice(0, 4)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void runSystemNow(a.key)}
                          disabled={busyKey === `run:sys:${a.key}`}
                          className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
                        >
                          {busyKey === `run:sys:${a.key}` ? "Starting..." : "Run now"}
                        </button>
                        <a
                          href={`/agents/runs/${r?.id ?? ""}`}
                          className={`rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40 ${
                            r?.id ? "" : "pointer-events-none opacity-50"
                          }`}
                        >
                          view run
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your agents</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Custom agents you created.</div>
          </div>
          <a href="/agents/new" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            New agent
          </a>
        </div>

        <div className="mt-4 space-y-3">
          {props.customAgents.map((a) => {
            const r = a.lastRun;
            const b = r ? badge(r.status) : null;
            return (
              <div key={a.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{a.name}</div>
                      {b ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${b.cls}`}>
                          {b.label}
                        </span>
                      ) : null}
                    </div>
                    {a.description ? (
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{a.description}</div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-zinc-500">
                      schedule: every {a.scheduleMinutes} min · last: {fmtWhen(a.lastRunAt ?? (r?.finishedAt ?? null))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCustom(a.id, !a.enabled)}
                      disabled={busyKey === `custom:${a.id}`}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        a.enabled
                          ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                          : "border-zinc-500/30 text-zinc-700 dark:text-zinc-300 bg-zinc-500/10"
                      }`}
                    >
                      {a.enabled ? "enabled" : "disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCustomNow(a.id)}
                      disabled={busyKey === `run:custom:${a.id}`}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
                    >
                      {busyKey === `run:custom:${a.id}` ? "Starting..." : "Run now"}
                    </button>
                    <a
                      href={`/agents/runs/${r?.id ?? ""}`}
                      className={`rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40 ${
                        r?.id ? "" : "pointer-events-none opacity-50"
                      }`}
                    >
                      view output
                    </a>
                    <button
                      type="button"
                      onClick={() => deleteCustom(a.id)}
                      disabled={busyKey === `custom-del:${a.id}`}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {!props.customAgents.length ? (
            <p className="text-sm text-zinc-500">No custom agents yet.</p>
          ) : null}
        </div>
      </section>

      {runStatus ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
          {runStatus}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent activity</div>
        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Latest agent runs (system + your agents).</div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-4 text-left font-medium">When</th>
                <th className="py-2 pr-4 text-left font-medium">Agent</th>
                <th className="py-2 pr-4 text-left font-medium">Status</th>
                <th className="py-2 pr-4 text-left font-medium">Duration</th>
                <th className="py-2 pr-4 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {props.recentRuns.slice(0, 30).map((r) => {
                const b = badge(r.status);
                const label = r.kind === "custom" ? "custom" : r.agentKey;
                return (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {fmtWhen(r.finishedAt ?? r.startedAt ?? null)}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{label}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${b.cls}`}>
                        {b.label}
                      </span>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {typeof r.durationMs === "number" ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {r.kind === "custom" ? (
                        <a href={`/agents/runs/${r.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                          open
                        </a>
                      ) : (
                        r.metrics
                          ? Object.entries(r.metrics)
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(" · ")
                          : "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
