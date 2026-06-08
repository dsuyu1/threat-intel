"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TabletopDifficultyLevel, TabletopScenarioType } from "../../lib/tabletop/types";

type CreateResponse = { ok: true; id: string | null } | { error: string };

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

const SCENARIO_TYPES: Array<{ id: TabletopScenarioType; label: string }> = [
  { id: "ransomware", label: "Ransomware" },
  { id: "supply_chain", label: "Supply chain" },
  { id: "insider", label: "Insider threat" },
  { id: "apt", label: "APT / intrusion set" },
  { id: "nation_state", label: "Nation state" },
  { id: "bcs", label: "Business continuity / outage" },
];

const DIFFICULTY_LEVELS: Array<{ id: TabletopDifficultyLevel; label: string }> = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

const DURATIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 90, label: "90 minutes (5 injects)" },
  { minutes: 120, label: "120 minutes (6 injects)" },
  { minutes: 240, label: "240 minutes (8 injects)" },
];

export function TabletopGenerateForm(props: { projectSlug: string }) {
  const router = useRouter();

  const [scenarioType, setScenarioType] = useState<TabletopScenarioType>("ransomware");
  const [difficultyLevel, setDifficultyLevel] = useState<TabletopDifficultyLevel>("intermediate");
  const [durationMinutes, setDurationMinutes] = useState<number>(120);
  const [actorMode, setActorMode] = useState<"suggest" | "chosen">("suggest");
  const [actorId, setActorId] = useState("");
  const [title, setTitle] = useState("");
  const [complianceTag, setComplianceTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!scenarioType) return false;
    if (!difficultyLevel) return false;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return false;
    if (title.length > 180) return false;
    if (complianceTag.length > 60) return false;
    if (actorMode === "chosen" && !actorId.trim()) return false;
    return true;
  }, [busy, scenarioType, difficultyLevel, durationMinutes, title, complianceTag, actorMode, actorId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError("");
    try {
      const body: Record<string, any> = {
        scenarioType,
        difficultyLevel,
        durationMinutes,
        actorMode,
        actorId: actorMode === "chosen" ? actorId.trim() : undefined,
        title: title.trim() || undefined,
        complianceTag: complianceTag.trim() || undefined,
      };

      const res = await fetch("/api/tabletop/exercises", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ti-project-slug": props.projectSlug,
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => null)) as CreateResponse | null;
      if (!res.ok || !json) {
        const msg = json && "error" in json ? json.error : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (!("ok" in json) || !json.ok) throw new Error("Request failed");
      if (!json.id) throw new Error("Exercise creation returned no id");

      router.push(`/p/${props.projectSlug}/tabletop/${json.id}`);
      router.refresh();
    } catch (e2) {
      setError(safeErrorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 shadow-2xl shadow-black/10 dark:shadow-black/40 space-y-4"
    >
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Generate tabletop package</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Produces a narrative, inject plan, role briefs, and facilitator guide grounded in your project data.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Scenario</div>
          <select
            value={scenarioType}
            disabled={busy}
            onChange={(e) => setScenarioType(e.target.value as TabletopScenarioType)}
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {SCENARIO_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Difficulty</div>
          <select
            value={difficultyLevel}
            disabled={busy}
            onChange={(e) => setDifficultyLevel(e.target.value as TabletopDifficultyLevel)}
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {DIFFICULTY_LEVELS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Duration</div>
        <select
          value={String(durationMinutes)}
          disabled={busy}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
        >
          {DURATIONS.map((d) => (
            <option key={d.minutes} value={String(d.minutes)}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Actor</div>
          <select
            value={actorMode}
            disabled={busy}
            onChange={(e) => setActorMode(e.target.value as any)}
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
          >
            <option value="suggest">Suggest from project</option>
            <option value="chosen">Choose actor id</option>
          </select>
        </label>

        {actorMode === "chosen" ? (
          <label className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Actor id</div>
            <input
              value={actorId}
              disabled={busy}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="e.g. apt28"
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Compliance tag (optional)</div>
          <input
            value={complianceTag}
            disabled={busy}
            onChange={(e) => setComplianceTag(e.target.value)}
            placeholder="SOC2, HIPAA, ISO, NIST..."
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>

        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Title (optional)</div>
          <input
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave blank to auto-title"
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate"}
        </button>
        <a
          href={`/p/${props.projectSlug}/tabletop`}
          className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
