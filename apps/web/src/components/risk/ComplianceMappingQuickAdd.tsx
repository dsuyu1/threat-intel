"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Framework = "nist_csf_2" | "cis_v8" | "iso_27001";
type SourceKind = "scenario" | "technique" | "mitigation";

const FRAMEWORKS: Array<{ id: Framework; label: string }> = [
  { id: "nist_csf_2", label: "NIST CSF 2.0" },
  { id: "cis_v8", label: "CIS v8" },
  { id: "iso_27001", label: "ISO 27001" },
];

function normalizeFramework(input: string): Framework {
  const s = String(input ?? "").trim();
  if (s === "cis_v8" || s === "iso_27001") return s;
  return "nist_csf_2";
}

export type ComplianceMappingSource = {
  kind: SourceKind;
  id: string;
  label: string;
};

export function ComplianceMappingQuickAdd(props: { projectSlug: string; sources: ComplianceMappingSource[] }) {
  const router = useRouter();
  const sources = props.sources.filter((s) => s.id);
  const [framework, setFramework] = useState<Framework>("nist_csf_2");
  const [sourceKey, setSourceKey] = useState<string>(sources[0] ? `${sources[0].kind}:${sources[0].id}` : "");
  const [controlId, setControlId] = useState("");
  const [controlTitle, setControlTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const selected = useMemo(() => {
    const [kind, ...rest] = String(sourceKey).split(":");
    const id = rest.join(":");
    const match = sources.find((s) => s.kind === kind && s.id === id);
    return match ?? (sources[0] ?? null);
  }, [sourceKey, sources]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const src = selected;
      if (!src) throw new Error("No source selected.");
      const item = {
        framework,
        sourceKind: src.kind,
        sourceId: src.id,
        controlId: controlId.trim(),
        controlTitle: controlTitle.trim() || null,
      };
      if (!item.controlId) throw new Error("Control ID is required.");

      const res = await fetch("/api/risk/compliance/mappings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ items: [item] }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setControlId("");
      setControlTitle("");
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Map</div>
          <select
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            disabled={busy || sources.length <= 1}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {sources.map((s) => (
              <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Framework</div>
          <select
            value={framework}
            onChange={(e) => setFramework(normalizeFramework(e.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {FRAMEWORKS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Control ID</div>
          <input
            value={controlId}
            onChange={(e) => setControlId(e.target.value)}
            disabled={busy}
            placeholder={framework === "nist_csf_2" ? "GV.OC-01" : framework === "cis_v8" ? "5.1" : "A.5.1"}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>

        <label className="block">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Title (optional)</div>
          <input
            value={controlTitle}
            onChange={(e) => setControlTitle(e.target.value)}
            disabled={busy}
            placeholder="Short title"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          {!error && savedAt ? <div className="text-xs text-zinc-500">Saved {new Date(savedAt).toLocaleTimeString()}</div> : null}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Add mapping"}
        </button>
      </div>
    </div>
  );
}
