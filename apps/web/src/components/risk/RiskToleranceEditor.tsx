"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function clamp0to100(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toNum(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function RiskToleranceEditor(props: {
  projectSlug: string;
  initial: { operational: number; financial: number; compliance: number; reputational: number };
}) {
  const router = useRouter();
  const [operational, setOperational] = useState(String(props.initial.operational));
  const [financial, setFinancial] = useState(String(props.initial.financial));
  const [compliance, setCompliance] = useState(String(props.initial.compliance));
  const [reputational, setReputational] = useState(String(props.initial.reputational));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/risk/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          operational: clamp0to100(toNum(operational)),
          financial: clamp0to100(toNum(financial)),
          compliance: clamp0to100(toNum(compliance)),
          reputational: clamp0to100(toNum(reputational)),
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

  const field = (label: string, value: string, setValue: (v: string) => void, help: string) => (
    <label className="block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</div>
      <div className="mt-1 text-xs text-zinc-500">{help}</div>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        className="mt-3 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
      />
      <div className="mt-1 text-[11px] text-zinc-500">Residual ≥ threshold is flagged as “over tolerance”.</div>
    </label>
  );

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {field("Operational", operational, setOperational, "Availability, service disruption, uptime.")}
        {field("Financial", financial, setFinancial, "Direct loss, fraud, revenue impact.")}
        {field("Compliance", compliance, setCompliance, "Regulatory, contractual, audit exposure.")}
        {field("Reputational", reputational, setReputational, "Brand, trust, customer impact.")}
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save tolerance"}
        </button>
      </div>
    </div>
  );
}
