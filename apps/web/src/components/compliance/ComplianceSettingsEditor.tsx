"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ComplianceFramework } from "../../lib/compliance";
import { COMPLIANCE_FRAMEWORKS, frameworkLabel } from "../../lib/compliance";

type Suggestion = { id: string; label: string; reason: string; available: boolean };

export function ComplianceSettingsEditor(props: {
  projectSlug: string;
  initial: {
    federalFunding: boolean;
    cyberInsurance: boolean;
    enabledFrameworks: ComplianceFramework[];
  };
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [federalFunding, setFederalFunding] = useState(Boolean(props.initial.federalFunding));
  const [cyberInsurance, setCyberInsurance] = useState(Boolean(props.initial.cyberInsurance));
  const [enabled, setEnabled] = useState<Record<ComplianceFramework, boolean>>(() => {
    const set = new Set(props.initial.enabledFrameworks);
    return {
      nist_csf_2: set.has("nist_csf_2"),
      cis_v8: set.has("cis_v8"),
      iso_27001: set.has("iso_27001"),
    };
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const requiredByFlags = useMemo(() => {
    const req = new Set<ComplianceFramework>();
    if (federalFunding) req.add("nist_csf_2");
    if (cyberInsurance) req.add("cis_v8");
    return req;
  }, [federalFunding, cyberInsurance]);

  const effectiveEnabled = useMemo(() => {
    const next = { ...enabled };
    for (const f of requiredByFlags) next[f] = true;
    return next;
  }, [enabled, requiredByFlags]);

  const toggle = (framework: ComplianceFramework) => {
    if (requiredByFlags.has(framework)) return;
    setEnabled((prev) => ({ ...prev, [framework]: !prev[framework] }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const enabledFrameworks = COMPLIANCE_FRAMEWORKS.filter((f) => effectiveEnabled[f]);
      const res = await fetch("/api/compliance/settings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ federalFunding, cyberInsurance, enabledFrameworks }),
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

  const suggestionItems = props.suggestions.filter((s) => s.reason);

  return (
    <div className="space-y-6">
      {suggestionItems.length ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detected requirements</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Based on Navigator setup. Some frameworks may be planned but not yet supported as dashboards.
          </div>
          <div className="mt-3 space-y-2">
            {suggestionItems.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/50 dark:bg-black/20 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.label}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{s.reason}</div>
                </div>
                <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {s.available ? "Available" : "Coming soon"}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Drivers</div>
        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Used to auto-enable required frameworks (you can override by changing these drivers).
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4">
            <input
              type="checkbox"
              checked={federalFunding}
              onChange={(e) => setFederalFunding(e.target.checked)}
              disabled={busy}
              className="mt-1"
            />
            <span className="min-w-0">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Federal funding</div>
              <div className="mt-1 text-xs text-zinc-500">Enables NIST CSF 2.0 dashboards as required.</div>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4">
            <input
              type="checkbox"
              checked={cyberInsurance}
              onChange={(e) => setCyberInsurance(e.target.checked)}
              disabled={busy}
              className="mt-1"
            />
            <span className="min-w-0">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Cyber insurance</div>
              <div className="mt-1 text-xs text-zinc-500">Enables CIS Controls v8 dashboards as required.</div>
            </span>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Dashboards</div>
        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Controls coverage is derived from Navigator evidence (validated scenarios, actions, and detections).
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {COMPLIANCE_FRAMEWORKS.map((fw) => {
            const required = requiredByFlags.has(fw);
            const checked = effectiveEnabled[fw];
            return (
              <button
                key={fw}
                type="button"
                onClick={() => toggle(fw)}
                disabled={busy || required}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  checked
                    ? "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/60 dark:bg-sky-950/20"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 hover:bg-black/5 dark:hover:bg-white/5"
                } ${required ? "opacity-80 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{frameworkLabel(fw)}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {required ? "Required" : checked ? "Enabled" : "Disabled"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <input type="checkbox" checked={checked} readOnly className="mt-1" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
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
          className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save settings"}
        </button>
      </div>
    </div>
  );
}

