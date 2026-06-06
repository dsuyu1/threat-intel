"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StepType = "fetch_findings" | "generate_report";

type Step = {
  id: string;
  type: StepType;
  params: Record<string, any>;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const FINDING_AGENTS = ["vuln", "attack", "ttp", "exploit", "malware"] as const;

function defaultSteps(): Step[] {
  return [
    {
      id: uid(),
      type: "fetch_findings",
      params: { hoursBack: 24, agents: ["vuln", "attack"], limit: 20 },
    },
    {
      id: uid(),
      type: "generate_report",
      params: {
        prompt:
          "Create a short daily intel brief tailored to my stack. Call out what changed, what to validate, and what to remediate first.",
        maxTokens: 800,
        temperature: 0.2,
      },
    },
  ];
}

export function AgentBuilder() {
  const router = useRouter();
  const [name, setName] = useState("Daily Intel Brief");
  const [description, setDescription] = useState("Summarize recent findings for my stack.");
  const [scheduleMinutes, setScheduleMinutes] = useState(1440);
  const [enabled, setEnabled] = useState(true);
  const [steps, setSteps] = useState<Step[]>(defaultSteps());
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const definition = useMemo(() => ({ version: 1, steps: steps.map(({ type, params }) => ({ type, params })) }), [steps]);

  const moveStep = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setSteps((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === fromId);
      const toIdx = prev.findIndex((s) => s.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.slice();
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item!);
      return next;
    });
  };

  const addStep = (type: StepType) => {
    setSteps((prev) => [
      ...prev,
      {
        id: uid(),
        type,
        params:
          type === "fetch_findings"
            ? { hoursBack: 24, agents: ["vuln"], limit: 20 }
            : { prompt: "Summarize what matters and why.", maxTokens: 800, temperature: 0.2 },
      },
    ]);
  };

  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id));

  const updateStepParams = (id: string, patch: Record<string, any>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, params: { ...s.params, ...patch } } : s)));
  };

  const toggleAgentFilter = (stepId: string, agent: string) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const cur = Array.isArray(s.params.agents) ? s.params.agents.map(String) : [];
        const next = cur.includes(agent) ? cur.filter((a) => a !== agent) : [...cur, agent];
        return { ...s, params: { ...s.params, agents: next } };
      })
    );
  };

  const save = async () => {
    const nm = name.trim();
    if (!nm) return alert("Name is required");
    setBusy(true);
    try {
      const res = await fetch("/api/agents/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nm,
          description: description.trim(),
          enabled,
          scheduleMinutes,
          definition,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      router.push("/agents");
      router.refresh();
    } catch (err) {
      alert(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <a href="/agents" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to Agents
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Create agent</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Point-and-click builder. Drag steps to reorder.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="My agent"
              disabled={busy}
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Schedule (minutes)</div>
            <input
              type="number"
              min={5}
              max={10080}
              value={scheduleMinutes}
              onChange={(e) => setScheduleMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              disabled={busy}
            />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Description</div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            placeholder="What does it do?"
            disabled={busy}
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
          Enabled
        </label>
      </section>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Steps</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Drag to reorder.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addStep("fetch_findings")}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40"
              disabled={busy}
            >
              + Findings
            </button>
            <button
              type="button"
              onClick={() => addStep("generate_report")}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs hover:bg-white dark:hover:bg-black/40"
              disabled={busy}
            >
              + Report
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {steps.map((s, idx) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) moveStep(dragId, s.id);
                setDragId(null);
              }}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-zinc-500">Step {idx + 1}</div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {s.type === "fetch_findings" ? "Fetch findings" : "Generate report"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeStep(s.id)}
                  className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                  disabled={busy}
                >
                  remove
                </button>
              </div>

              {s.type === "fetch_findings" ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="block">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Hours back</div>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={Number(s.params.hoursBack ?? 24)}
                      onChange={(e) => updateStepParams(s.id, { hoursBack: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      disabled={busy}
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Limit</div>
                    <input
                      type="number"
                      min={5}
                      max={80}
                      value={Number(s.params.limit ?? 20)}
                      onChange={(e) => updateStepParams(s.id, { limit: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      disabled={busy}
                    />
                  </label>
                  <div className="block">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Agents</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {FINDING_AGENTS.map((a) => {
                        const cur = Array.isArray(s.params.agents) ? s.params.agents.map(String) : [];
                        const on = cur.includes(a);
                        return (
                          <button
                            key={a}
                            type="button"
                            onClick={() => toggleAgentFilter(s.id, a)}
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              on
                                ? "border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10"
                                : "border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 bg-white/40 dark:bg-black/20"
                            }`}
                            disabled={busy}
                          >
                            {a}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Prompt</div>
                    <textarea
                      value={String(s.params.prompt ?? "")}
                      onChange={(e) => updateStepParams(s.id, { prompt: e.target.value })}
                      className="mt-1 w-full min-h-[120px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      disabled={busy}
                    />
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Max tokens</div>
                      <input
                        type="number"
                        min={200}
                        max={2000}
                        value={Number(s.params.maxTokens ?? 800)}
                        onChange={(e) => updateStepParams(s.id, { maxTokens: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        disabled={busy}
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Temperature</div>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={Number(s.params.temperature ?? 0.2)}
                        onChange={(e) => updateStepParams(s.id, { temperature: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        disabled={busy}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={save}
            className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save agent"}
          </button>
        </div>
      </section>
    </div>
  );
}

