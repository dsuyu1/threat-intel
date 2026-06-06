"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type RiskStatus = "open" | "accepted" | "mitigating" | "closed";
type RiskCategory = "operational" | "financial" | "compliance" | "reputational";

const STATUS_OPTIONS: Array<{ id: RiskStatus; label: string; help: string }> = [
  { id: "open", label: "Open", help: "Needs attention." },
  { id: "mitigating", label: "Mitigating", help: "Work in progress." },
  { id: "accepted", label: "Accepted", help: "Explicitly accepted." },
  { id: "closed", label: "Closed", help: "Resolved or no longer relevant." },
];

const CATEGORY_OPTIONS: Array<{ id: RiskCategory; label: string; help: string }> = [
  { id: "operational", label: "Operational", help: "Availability, service disruption, uptime." },
  { id: "financial", label: "Financial", help: "Direct loss, fraud, revenue impact." },
  { id: "compliance", label: "Compliance", help: "Regulatory, contractual, audit exposure." },
  { id: "reputational", label: "Reputational", help: "Brand, trust, customer impact." },
];

function normalizeStatus(input: string): RiskStatus {
  const s = String(input ?? "").trim();
  if (s === "accepted" || s === "mitigating" || s === "closed") return s;
  return "open";
}

function normalizeCategory(input: string): RiskCategory {
  const s = String(input ?? "").trim();
  if (s === "financial" || s === "compliance" || s === "reputational") return s;
  return "operational";
}

export function RiskEntryEditor(props: {
  projectSlug: string;
  scenarioId: string;
  initialStatus: string;
  initialCategory?: string;
  initialOwner?: string | null;
  initialNotes?: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<RiskStatus>(normalizeStatus(props.initialStatus));
  const [category, setCategory] = useState<RiskCategory>(normalizeCategory(props.initialCategory ?? "operational"));
  const [owner, setOwner] = useState<string>(String(props.initialOwner ?? ""));
  const [notes, setNotes] = useState<string>(String(props.initialNotes ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const statusHelp = useMemo(() => STATUS_OPTIONS.find((o) => o.id === status)?.help ?? "", [status]);
  const categoryHelp = useMemo(() => CATEGORY_OPTIONS.find((o) => o.id === category)?.help ?? "", [category]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk/entries/${props.scenarioId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ status, category, owner, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
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
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(normalizeStatus(e.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {statusHelp ? <div className="mt-1 text-[11px] text-zinc-500">{statusHelp}</div> : null}
        </label>

        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(normalizeCategory(e.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {categoryHelp ? <div className="mt-1 text-[11px] text-zinc-500">{categoryHelp}</div> : null}
        </label>

        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Owner</div>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            disabled={busy}
            placeholder="Team or person"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          rows={7}
          placeholder="What’s the risk? What’s the plan? What evidence supports the likelihood/impact?"
          className="mt-1 w-full resize-y rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </label>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          {!error && savedAt ? (
            <div className="text-xs text-zinc-500">Saved {new Date(savedAt).toLocaleTimeString()}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
