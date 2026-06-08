"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlaybookContentV1, PlaybookPhase, PlaybookToolAction } from "../../lib/playbooks/types";

type TabId = "analyst" | "executive" | "timeline" | "post";

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function sumMinutes(phases: PlaybookPhase[]) {
  let total = 0;
  for (const p of phases) {
    total += Number(p.estimatedMinutes ?? 0);
    for (const s of p.steps) total += Number(s.estimatedMinutes ?? 0);
  }
  return total;
}

function fmtDurationMinutes(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "\u2014";
  const m = Math.max(0, Math.round(minutes));
  if (m < 90) return `${m}m`;
  const hours = Math.round((m / 60) * 10) / 10;
  if (hours < 72) return `${hours}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

type IncidentOption = {
  id: string;
  title: string | null;
  status: string | null;
  incidentType: string | null;
  externalId: string;
  externalNumber: number | null;
  detectedAt: string | null;
  containedAt: string | null;
  closedAt: string | null;
};

type ReviewStepStatus = "done" | "skipped";
type ReviewToolActionStatus = "succeeded" | "failed" | "not_used";

type ReviewStepInput = {
  stepId: string;
  status: ReviewStepStatus;
  actualMinutes: string;
  notes: string;
};

type ReviewToolActionInput = {
  stepId: string;
  actionIndex: number;
  status: ReviewToolActionStatus;
  error: string;
};

function minutesBetween(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  const ms = db.getTime() - da.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60_000);
}

async function copy(text: string) {
  const s = String(text ?? "");
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
}

function ToolBadge(props: { tool: PlaybookToolAction["tool"] }) {
  const c = (() => {
    if (props.tool === "splunk") return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20";
    if (props.tool === "jira") return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20";
    if (props.tool === "slack") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
    if (props.tool === "discord") return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20";
    if (props.tool === "soar") return "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/20";
    return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20";
  })();
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", c)}>
      {props.tool}
    </span>
  );
}

function StepAction(props: { action: PlaybookToolAction }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copy(props.action.content);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ToolBadge tool={props.action.tool} />
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{props.action.label}</div>
        </div>
        <div className="flex items-center gap-2">
          {props.action.href ? (
            <a
              href={props.action.href}
              className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Open →
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void onCopy()}
            className="h-7 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-300 font-mono">
        {props.action.content}
      </pre>
    </div>
  );
}

function PhaseSection(props: { phase: PlaybookPhase }) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            {props.phase.title}
          </h3>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{props.phase.description}</p>
        </div>
        {typeof props.phase.estimatedMinutes === "number" ? (
          <div className="text-xs text-zinc-500 tabular-nums">{props.phase.estimatedMinutes}m</div>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {props.phase.steps.map((s) => (
          <div key={s.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{s.description}</div>
                <div className="mt-2 text-xs text-zinc-500">
                  Owner: <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.ownerRole}</span>
                  {typeof s.estimatedMinutes === "number" ? (
                    <span className="ml-2 tabular-nums">{s.estimatedMinutes}m</span>
                  ) : null}
                </div>
              </div>
            </div>

            {s.toolActions?.length ? (
              <div className="mt-3 space-y-2">
                {s.toolActions.map((a, idx) => (
                  <StepAction key={`${s.id}:${idx}:${a.tool}:${a.label}`} action={a} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PlaybookViewer(props: { content: PlaybookContentV1; playbookId: string; projectSlug: string }) {
  const [tab, setTab] = useState<TabId>("analyst");

  const totalMinutes = useMemo(() => sumMinutes(props.content.phases), [props.content.phases]);

  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);
  const [incidentId, setIncidentId] = useState<string>("");
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [postError, setPostError] = useState<string>("");
  const [postNotice, setPostNotice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [effectivenessScore, setEffectivenessScore] = useState<number | null>(null);

  const stepDefaults = useMemo(() => {
    const out: Record<string, ReviewStepInput> = {};
    for (const p of props.content.phases) {
      for (const s of p.steps) {
        out[s.id] = { stepId: s.id, status: "done", actualMinutes: "", notes: "" };
      }
    }
    return out;
  }, [props.content.phases]);

  const toolDefaults = useMemo(() => {
    const out: Record<string, ReviewToolActionInput> = {};
    for (const p of props.content.phases) {
      for (const s of p.steps) {
        const actions = s.toolActions ?? [];
        for (let i = 0; i < actions.length; i++) {
          out[`${s.id}:${i}`] = { stepId: s.id, actionIndex: i, status: "not_used", error: "" };
        }
      }
    }
    return out;
  }, [props.content.phases]);

  const [stepState, setStepState] = useState<Record<string, ReviewStepInput>>(() => stepDefaults);
  const [toolState, setToolState] = useState<Record<string, ReviewToolActionInput>>(() => toolDefaults);

  useEffect(() => {
    if (tab !== "post") return;
    if (incidentsLoaded) return;
    setIncidentsLoaded(true);
    setIncidentBusy(true);
    setPostError("");
    fetch("/api/incidents?closed=1", { headers: { "x-ti-project-slug": props.projectSlug } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));
        const list = Array.isArray(body?.incidents) ? (body.incidents as any[]) : [];
        const mapped: IncidentOption[] = list.map((x) => ({
          id: String(x?.id ?? ""),
          title: x?.title ? String(x.title) : null,
          status: x?.status ? String(x.status) : null,
          incidentType: x?.incidentType ? String(x.incidentType) : null,
          externalId: String(x?.externalId ?? ""),
          externalNumber: typeof x?.externalNumber === "number" ? x.externalNumber : x?.externalNumber != null ? Number(x.externalNumber) : null,
          detectedAt: x?.detectedAt ? String(x.detectedAt) : null,
          containedAt: x?.containedAt ? String(x.containedAt) : null,
          closedAt: x?.closedAt ? String(x.closedAt) : null,
        }));
        setIncidents(mapped.filter((x) => x.id));
      })
      .catch((e) => setPostError(e instanceof Error ? e.message : "Failed to load incidents"))
      .finally(() => setIncidentBusy(false));
  }, [tab, incidentsLoaded, props.projectSlug]);

  const selectedIncident = useMemo(
    () => incidents.find((x) => x.id === incidentId) ?? null,
    [incidents, incidentId]
  );
  const actualTotalMinutes = useMemo(
    () => minutesBetween(selectedIncident?.detectedAt ?? null, selectedIncident?.containedAt ?? null),
    [selectedIncident]
  );

  const loadReview = async (id: string) => {
    setReviewBusy(true);
    setPostError("");
    setPostNotice("");
    setEffectivenessScore(null);
    try {
      const res = await fetch(`/api/playbooks/${props.playbookId}/post-incident?incidentId=${encodeURIComponent(id)}`, {
        headers: { "x-ti-project-slug": props.projectSlug },
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));

      const review = body?.review ?? null;
      if (!review) {
        setNotes("");
        setStepState({ ...stepDefaults });
        setToolState({ ...toolDefaults });
        setEffectivenessScore(null);
        return;
      }

      setNotes(typeof review?.notes === "string" ? review.notes : "");
      setEffectivenessScore(typeof review?.effectivenessScore === "number" ? review.effectivenessScore : null);

      const nextSteps: Record<string, ReviewStepInput> = { ...stepDefaults };
      const stepRows = Array.isArray(review?.steps) ? (review.steps as any[]) : [];
      for (const s of stepRows) {
        const stepId = String(s?.stepId ?? "");
        if (!nextSteps[stepId]) continue;
        nextSteps[stepId] = {
          stepId,
          status: String(s?.status ?? "done") === "skipped" ? "skipped" : "done",
          actualMinutes: s?.actualMinutes != null ? String(s.actualMinutes) : "",
          notes: s?.notes != null ? String(s.notes) : "",
        };
      }
      setStepState(nextSteps);

      const nextTools: Record<string, ReviewToolActionInput> = { ...toolDefaults };
      const toolRows = Array.isArray(review?.toolActions) ? (review.toolActions as any[]) : [];
      for (const a of toolRows) {
        const stepId = String(a?.stepId ?? "");
        const idx = Number(a?.actionIndex);
        const key = `${stepId}:${idx}`;
        if (!nextTools[key]) continue;
        const statusRaw = String(a?.status ?? "not_used");
        const status: ReviewToolActionStatus =
          statusRaw === "failed" ? "failed" : statusRaw === "succeeded" ? "succeeded" : "not_used";
        nextTools[key] = {
          stepId,
          actionIndex: idx,
          status,
          error: a?.error != null ? String(a.error) : "",
        };
      }
      setToolState(nextTools);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : "Failed to load review");
    } finally {
      setReviewBusy(false);
    }
  };

  const saveReview = async () => {
    if (!incidentId) return;
    setReviewBusy(true);
    setPostError("");
    setPostNotice("");
    try {
      const steps: Array<{ stepId: string; status: ReviewStepStatus; actualMinutes?: number | null; notes?: string | null }> = [];
      const toolActions: Array<{ stepId: string; actionIndex: number; status: ReviewToolActionStatus; error?: string | null }> = [];

      for (const p of props.content.phases) {
        for (const s of p.steps) {
          const st = stepState[s.id] ?? { stepId: s.id, status: "done", actualMinutes: "", notes: "" };
          const mins = st.actualMinutes.trim() ? Number(st.actualMinutes) : null;
          steps.push({
            stepId: s.id,
            status: st.status,
            actualMinutes: mins != null && Number.isFinite(mins) ? Math.max(0, Math.round(mins)) : null,
            notes: st.notes.trim() ? st.notes.trim() : null,
          });

          const actions = s.toolActions ?? [];
          for (let i = 0; i < actions.length; i++) {
            const key = `${s.id}:${i}`;
            const ta = toolState[key] ?? { stepId: s.id, actionIndex: i, status: "not_used", error: "" };
            toolActions.push({
              stepId: s.id,
              actionIndex: i,
              status: ta.status,
              error: ta.error.trim() ? ta.error.trim() : null,
            });
          }
        }
      }

      const res = await fetch(`/api/playbooks/${props.playbookId}/post-incident?incidentId=${encodeURIComponent(incidentId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ notes: notes.trim() ? notes.trim() : null, steps, toolActions }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));

      setEffectivenessScore(typeof body?.effectivenessScore === "number" ? body.effectivenessScore : null);
      setPostNotice("Saved.");
    } catch (e) {
      setPostError(e instanceof Error ? e.message : "Failed to save review");
    } finally {
      setReviewBusy(false);
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "analyst", label: "Analyst" },
    { id: "executive", label: "Executive" },
    { id: "timeline", label: "Timeline" },
    { id: "post", label: "Post-incident" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                "h-9 rounded-lg px-3 text-sm transition-colors",
                tab === t.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-zinc-500 tabular-nums">
          Estimated effort: {Math.max(0, Math.round(totalMinutes))}m
        </div>
      </div>

      {tab === "executive" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Summary</h3>
          <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
            {props.content.executiveSummary}
          </pre>
        </section>
      ) : null}

      {tab === "timeline" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Timeline</h3>
          <div className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {props.content.phases.map((p) => {
              const mins =
                Number(p.estimatedMinutes ?? 0) +
                p.steps.reduce((acc, s) => acc + Number(s.estimatedMinutes ?? 0), 0);
              return (
                <div key={p.id} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2">
                  <div className="font-medium">{p.title}</div>
                  <div className="tabular-nums text-zinc-500">{Math.max(0, Math.round(mins))}m</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-zinc-500">
            Estimates are rough and should be adjusted during review.
          </div>
        </section>
      ) : null}

      {tab === "post" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Post-incident
          </h3>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Closed incident</div>
                <select
                  className="mt-1 w-full h-10 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm"
                  value={incidentId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setIncidentId(id);
                    if (id) void loadReview(id);
                  }}
                  disabled={incidentBusy || reviewBusy}
                >
                  <option value="">{incidentBusy ? "Loading…" : "Select an incident"}</option>
                  {incidents.map((x) => {
                    const num = typeof x.externalNumber === "number" && Number.isFinite(x.externalNumber) ? `#${x.externalNumber}` : null;
                    const title = x.title ? x.title : x.externalId;
                    const when = x.closedAt ?? x.containedAt ?? x.detectedAt;
                    const whenLabel = when ? new Date(when).toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : "";
                    return (
                      <option key={x.id} value={x.id}>
                        {num ? `${num} ` : ""}{title}{whenLabel ? ` (${whenLabel})` : ""}
                      </option>
                    );
                  })}
                </select>
                <div className="mt-1 text-[11px] text-zinc-500">
                  Pulls from synced TheHive cases. Manage sync in{" "}
                  <a href="/integrations/thehive" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                    Connections
                  </a>
                  .
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Estimate</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {fmtDurationMinutes(Math.round(totalMinutes))}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">Total playbook minutes (phases + steps).</div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Actual</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {fmtDurationMinutes(actualTotalMinutes)}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">Detected → contained (from TheHive).</div>
              </div>
            </div>

            {typeof effectivenessScore === "number" ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-900 dark:text-emerald-200">
                Playbook effectiveness score: <span className="font-semibold tabular-nums">{Math.round(effectivenessScore)}</span>/100
              </div>
            ) : null}

            <div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full min-h-[90px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm"
                placeholder="Lessons learned, improvements, or detection gaps…"
                disabled={!incidentId || reviewBusy}
              />
            </div>

            {!incidentId ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Select an incident to review step completion and tool outcomes.
              </div>
            ) : (
              <div className="space-y-4">
                {props.content.phases.map((p) => (
                  <section key={p.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                          {p.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{p.description}</div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {p.steps.map((s) => {
                        const st = stepState[s.id] ?? { stepId: s.id, status: "done", actualMinutes: "", notes: "" };
                        const onStep = (patch: Partial<ReviewStepInput>) =>
                          setStepState((prev) => ({ ...prev, [s.id]: { ...st, ...patch } }));

                        return (
                          <div key={s.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 p-4">
                            <div className="flex flex-col gap-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
                                  <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{s.description}</div>
                                  <div className="mt-2 text-xs text-zinc-500">
                                    Owner: <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.ownerRole}</span>
                                    {typeof s.estimatedMinutes === "number" ? (
                                      <span className="ml-2 tabular-nums">{s.estimatedMinutes}m</span>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="shrink-0 flex flex-col gap-2 items-end">
                                  <select
                                    className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-2 text-sm"
                                    value={st.status}
                                    onChange={(e) => onStep({ status: e.target.value === "skipped" ? "skipped" : "done" })}
                                    disabled={reviewBusy}
                                  >
                                    <option value="done">Done</option>
                                    <option value="skipped">Skipped</option>
                                  </select>

                                  <input
                                    className="h-9 w-[120px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-2 text-sm"
                                    value={st.actualMinutes}
                                    onChange={(e) => onStep({ actualMinutes: e.target.value })}
                                    placeholder="Actual (m)"
                                    inputMode="numeric"
                                    disabled={reviewBusy}
                                  />
                                </div>
                              </div>

                              <textarea
                                className="w-full min-h-[60px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm"
                                value={st.notes}
                                onChange={(e) => onStep({ notes: e.target.value })}
                                placeholder="Notes (optional)"
                                disabled={reviewBusy}
                              />

                              {s.toolActions?.length ? (
                                <div className="space-y-2">
                                  {s.toolActions.map((a, idx) => {
                                    const key = `${s.id}:${idx}`;
                                    const ta = toolState[key] ?? { stepId: s.id, actionIndex: idx, status: "not_used", error: "" };
                                    const onTool = (patch: Partial<ReviewToolActionInput>) =>
                                      setToolState((prev) => ({ ...prev, [key]: { ...ta, ...patch } }));

                                    return (
                                      <div key={key} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/10 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <ToolBadge tool={a.tool} />
                                            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{a.label}</div>
                                          </div>
                                          <select
                                            className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-2 text-xs"
                                            value={ta.status}
                                            onChange={(e) => {
                                              const v = e.target.value as ReviewToolActionStatus;
                                              onTool({ status: v });
                                              if (v !== "failed") onTool({ error: "" });
                                            }}
                                            disabled={reviewBusy}
                                          >
                                            <option value="not_used">Not used</option>
                                            <option value="succeeded">Succeeded</option>
                                            <option value="failed">Failed</option>
                                          </select>
                                        </div>

                                        {ta.status === "failed" ? (
                                          <input
                                            className="mt-2 w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm"
                                            value={ta.error}
                                            onChange={(e) => onTool({ error: e.target.value })}
                                            placeholder="Failure reason (optional)"
                                            disabled={reviewBusy}
                                          />
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="h-9 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                    disabled={reviewBusy || incidentBusy}
                    onClick={() => void saveReview()}
                  >
                    {reviewBusy ? "Saving…" : "Save review"}
                  </button>

                  {postNotice ? <div className="text-xs text-emerald-600 dark:text-emerald-400">{postNotice}</div> : null}
                  {postError ? <div className="text-xs text-rose-600 dark:text-rose-400">{postError}</div> : null}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {tab === "analyst" ? (
        <div className="space-y-4">
          {props.content.phases.map((p) => (
            <PhaseSection key={p.id} phase={p} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
