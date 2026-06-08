"use client";

import { useEffect, useMemo, useState } from "react";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

type SessionState = {
  id: string;
  status: "scheduled" | "in_progress" | "completed";
  currentSequence: number;
  facilitatorUserId: string;
  startedAt: string | null;
  endedAt: string | null;
};

export function TabletopFacilitatorConsole(props: {
  projectSlug: string;
  exerciseId: string;
  initialSession: SessionState | null;
}) {
  const [session, setSession] = useState<SessionState | null>(props.initialSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const participantHref = useMemo(() => {
    if (!session?.id) return null;
    return `/p/${props.projectSlug}/tabletop/sessions/${session.id}`;
  }, [session?.id, props.projectSlug]);

  useEffect(() => {
    if (!session?.id) return;
    if (session.status === "completed") return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(session.id)}`, {
          headers: { "x-ti-project-slug": props.projectSlug },
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.ok) return;
        if (cancelled) return;
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: String(json.session?.status ?? prev.status) as any,
            currentSequence: Number(json.session?.currentSequence ?? prev.currentSequence),
            startedAt: json.session?.startedAt ? String(json.session.startedAt) : prev.startedAt,
            endedAt: json.session?.endedAt ? String(json.session.endedAt) : prev.endedAt,
          };
        });
      } catch {
        // ignore
      }
    };

    const id = setInterval(tick, 4500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session?.id, session?.status, props.projectSlug]);

  const startSession = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tabletop/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ti-project-slug": props.projectSlug,
        },
        body: JSON.stringify({ exerciseId: props.exerciseId }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      if (!json.id) throw new Error("Session creation returned no id");
      setSession({ id: String(json.id), status: "in_progress", currentSequence: 0, facilitatorUserId: "", startedAt: null, endedAt: null });
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const advance = async () => {
    if (!session?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(session.id)}/advance`, {
        method: "POST",
        headers: { "x-ti-project-slug": props.projectSlug },
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setSession((s) => (s ? { ...s, currentSequence: Number(json.currentSequence ?? s.currentSequence) } : s));
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!session?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tabletop/sessions/${encodeURIComponent(session.id)}/complete`, {
        method: "POST",
        headers: { "x-ti-project-slug": props.projectSlug },
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setSession((s) => (s ? { ...s, status: "completed" } : s));
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Session</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {session ? (
                <>
                  Status: {session.status} • Released injects: {session.currentSequence}
                </>
              ) : (
                "No active session yet."
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!session || session.status === "completed" ? (
              <button
                type="button"
                onClick={startSession}
                disabled={busy}
                className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
              >
                {busy ? "Starting…" : "Start session"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={advance}
                  disabled={busy}
                  className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                >
                  {busy ? "Releasing…" : "Release next inject"}
                </button>
                <button
                  type="button"
                  onClick={complete}
                  disabled={busy}
                  className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors disabled:opacity-60"
                >
                  Complete
                </button>
              </>
            )}
          </div>
        </div>

        {participantHref ? (
          <div className="text-sm text-zinc-700 dark:text-zinc-200">
            Participant link:{" "}
            <a href={participantHref} className="underline hover:opacity-90">
              {participantHref}
            </a>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Facilitation tips</div>
        <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-300 list-disc pl-5 space-y-1">
          <li>Release injects as the group completes discussion and decisions for the previous one.</li>
          <li>Capture gaps as findings and link to Navigator scenarios when applicable.</li>
          <li>Close the session to lock the exercise and move into AAR actions.</li>
        </ul>
      </div>
    </div>
  );
}
