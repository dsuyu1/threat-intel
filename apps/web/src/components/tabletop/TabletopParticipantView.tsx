"use client";

import { useEffect, useMemo, useState } from "react";
import type { TabletopFindingSeverity } from "../../lib/tabletop/types";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

type ReleasedInject = {
  id: string;
  sequence: number;
  tPlusMinutes: number;
  title: string;
  situation: string;
  attackTechniqueId: string | null;
  discussionQuestions: string[];
  evaluationCriteria: string[];
};

export function TabletopParticipantView(props: { projectSlug: string; sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roleName, setRoleName] = useState("");
  const [session, setSession] = useState<{ status: string; currentSequence: number; isFacilitator: boolean; exerciseTitle: string } | null>(null);
  const [injects, setInjects] = useState<ReleasedInject[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [findingGap, setFindingGap] = useState("");
  const [findingSeverity, setFindingSeverity] = useState<TabletopFindingSeverity>("medium");
  const [findingScenarioId, setFindingScenarioId] = useState("");

  const latestInjectId = useMemo(() => {
    const last = injects[injects.length - 1];
    return last?.id ?? null;
  }, [injects]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(props.sessionId)}`, {
          headers: { "x-ti-project-slug": props.projectSlug },
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.ok) return;
        if (cancelled) return;

        setSession({
          status: String(json.session?.status ?? ""),
          currentSequence: Number(json.session?.currentSequence ?? 0),
          isFacilitator: Boolean(json.me?.isFacilitator),
          exerciseTitle: String(json.exercise?.title ?? ""),
        });

        const released = Array.isArray(json.releasedInjects) ? (json.releasedInjects as any[]) : [];
        setInjects(
          released.map((i) => ({
            id: String(i.id),
            sequence: Number(i.sequence ?? 0),
            tPlusMinutes: Number(i.tPlusMinutes ?? 0),
            title: String(i.title ?? ""),
            situation: String(i.situation ?? ""),
            attackTechniqueId: i.attackTechniqueId ? String(i.attackTechniqueId) : null,
            discussionQuestions: Array.isArray(i.discussionQuestions) ? i.discussionQuestions.map((x: any) => String(x ?? "")) : [],
            evaluationCriteria: Array.isArray(i.evaluationCriteria) ? i.evaluationCriteria.map((x: any) => String(x ?? "")) : [],
          }))
        );

        const rn = String(json.me?.roleName ?? "");
        if (rn && !roleName) setRoleName(rn);
      } catch {
        // ignore
      }
    };

    const id = setInterval(tick, 3500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [props.projectSlug, props.sessionId, roleName]);

  const join = async () => {
    if (busy) return;
    const rn = roleName.trim();
    if (!rn) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(props.sessionId)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ roleName: rn }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitResponse = async (injectId: string) => {
    if (busy) return;
    const text = String(responses[injectId] ?? "").trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(props.sessionId)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ injectId, response: text, roleName: roleName.trim() || undefined }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setResponses((r) => ({ ...r, [injectId]: "" }));
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitFinding = async () => {
    if (busy) return;
    const gap = findingGap.trim();
    if (!gap) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(props.sessionId)}/findings`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          gap,
          severity: findingSeverity,
          linkedNavigatorScenarioId: findingScenarioId.trim() || undefined,
          injectId: latestInjectId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setFindingGap("");
      setFindingScenarioId("");
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {session?.exerciseTitle ? session.exerciseTitle : "Session"}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {session ? (
                <>
                  Status: {session.status} • Released injects: {session.currentSequence}
                </>
              ) : (
                "Loading…"
              )}
            </div>
          </div>
          {session?.isFacilitator ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">You are the facilitator for this session.</div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <label className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Your role</div>
            <input
              value={roleName}
              disabled={busy}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="e.g. SOC lead"
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>
          <button
            type="button"
            onClick={join}
            disabled={busy || !roleName.trim()}
            className="h-10 inline-flex items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
          >
            Save role
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {injects.length ? (
          injects.map((inj) => (
            <div
              key={inj.id}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    #{inj.sequence} • T+{inj.tPlusMinutes}m • {inj.title}
                  </div>
                  {inj.attackTechniqueId ? (
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Technique: {inj.attackTechniqueId}</div>
                  ) : null}
                </div>
              </div>

              <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{inj.situation}</div>

              {inj.discussionQuestions.length ? (
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Discussion questions</div>
                  <ul className="mt-2 text-sm text-zinc-700 dark:text-zinc-200 list-disc pl-5 space-y-1">
                    {inj.discussionQuestions.slice(0, 8).map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <label className="space-y-1 block">
                <div className="text-xs uppercase tracking-wide text-zinc-500">Your response / notes</div>
                <textarea
                  value={responses[inj.id] ?? ""}
                  disabled={busy}
                  onChange={(e) => setResponses((r) => ({ ...r, [inj.id]: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 p-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
                />
              </label>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => submitResponse(inj.id)}
                  disabled={busy || !String(responses[inj.id] ?? "").trim()}
                  className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                >
                  Submit response
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 text-sm text-zinc-600 dark:text-zinc-300">
            No injects released yet. Stay on this page; injects appear automatically every few seconds once released.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 space-y-3">
        <div>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Capture a gap (finding)</div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Use this to record an improvement opportunity during the exercise.</div>
        </div>

        <label className="space-y-1 block">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Gap</div>
          <textarea
            value={findingGap}
            disabled={busy}
            onChange={(e) => setFindingGap(e.target.value)}
            rows={3}
            placeholder="What needs to change? (process, tooling, ownership, coverage...)"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 p-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Severity</div>
            <select
              value={findingSeverity}
              disabled={busy}
              onChange={(e) => setFindingSeverity(e.target.value as any)}
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Link Navigator scenario id (optional)</div>
            <input
              value={findingScenarioId}
              disabled={busy}
              onChange={(e) => setFindingScenarioId(e.target.value)}
              placeholder="UUID"
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={submitFinding}
            disabled={busy || !findingGap.trim()}
            className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
          >
            Add finding
          </button>
        </div>
      </div>
    </div>
  );
}
