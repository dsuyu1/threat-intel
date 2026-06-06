"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function toNumberOrNull(value: string) {
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function RiskFairLiteEditor(props: {
  projectSlug: string;
  scenarioId: string;
  initialFairLef?: number | null;
  initialFairLmLow?: number | null;
  initialFairLmHigh?: number | null;
}) {
  const router = useRouter();
  const [fairLef, setFairLef] = useState(props.initialFairLef != null ? String(props.initialFairLef) : "");
  const [fairLmLow, setFairLmLow] = useState(props.initialFairLmLow != null ? String(props.initialFairLmLow) : "");
  const [fairLmHigh, setFairLmHigh] = useState(props.initialFairLmHigh != null ? String(props.initialFairLmHigh) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = useMemo(() => {
    const lef = toNumberOrNull(fairLef);
    const low = toNumberOrNull(fairLmLow);
    const high = toNumberOrNull(fairLmHigh);
    if (lef == null || low == null || high == null) return null;
    if (lef < 0 || low < 0 || high < 0) return null;
    if (high < low) return { error: "High loss magnitude must be ≥ low." };
    return {
      perEventLow: low,
      perEventHigh: high,
      annualLow: lef * low,
      annualHigh: lef * high,
      lef,
    };
  }, [fairLef, fairLmLow, fairLmHigh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk/entries/${props.scenarioId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          fairLef,
          fairLmLow,
          fairLmHigh,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Loss event frequency (per year)</div>
          <input
            type="number"
            min={0}
            step={0.1}
            value={fairLef}
            onChange={(e) => setFairLef(e.target.value)}
            disabled={busy}
            placeholder="e.g., 0.5"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Loss magnitude (low)</div>
          <input
            type="number"
            min={0}
            step={1000}
            value={fairLmLow}
            onChange={(e) => setFairLmLow(e.target.value)}
            disabled={busy}
            placeholder="e.g., 50000"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Loss magnitude (high)</div>
          <input
            type="number"
            min={0}
            step={1000}
            value={fairLmHigh}
            onChange={(e) => setFairLmHigh(e.target.value)}
            disabled={busy}
            placeholder="e.g., 500000"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Estimated exposure</div>
        {derived && "error" in derived ? (
          <div className="mt-2 text-sm text-red-600 dark:text-red-400">{derived.error}</div>
        ) : derived ? (
          <div className="mt-2 space-y-1">
            <div className="text-sm text-zinc-700 dark:text-zinc-300">
              Per-event: <span className="tabular-nums">${nf(derived.perEventLow)}</span> –{" "}
              <span className="tabular-nums">${nf(derived.perEventHigh)}</span>
            </div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300">
              Annualized: <span className="tabular-nums">${nf(derived.annualLow)}</span> –{" "}
              <span className="tabular-nums">${nf(derived.annualHigh)}</span>
            </div>
            <div className="text-[11px] text-zinc-500">
              Rough FAIR-lite: LEF × loss magnitude. Use as a stakeholder-facing estimate, not a guarantee.
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-zinc-500">Fill in all three fields to compute a range.</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">{error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}</div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save FAIR-lite"}
        </button>
      </div>
    </div>
  );
}
