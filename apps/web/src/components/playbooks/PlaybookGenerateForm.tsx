"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaybookIncidentType, PlaybookSourceKind } from "../../lib/playbooks/types";

type CreateResponse = { ok: true; id: string | null } | { error: string };

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

const INCIDENT_TYPES: Array<{ id: PlaybookIncidentType; label: string }> = [
  { id: "vulnerability_exploitation", label: "Vulnerability exploitation" },
  { id: "credential_compromise", label: "Credential compromise" },
  { id: "lateral_movement", label: "Lateral movement" },
  { id: "data_exfiltration", label: "Data exfiltration" },
  { id: "ransomware", label: "Ransomware" },
  { id: "supply_chain", label: "Supply chain" },
];

function incidentTypeLabel(t: PlaybookIncidentType) {
  return INCIDENT_TYPES.find((x) => x.id === t)?.label ?? t;
}

export function PlaybookGenerateForm(props: {
  projectSlug: string;
  initial?: {
    sourceKind?: PlaybookSourceKind;
    sourceId?: string;
    incidentType?: PlaybookIncidentType;
    title?: string;
  };
}) {
  const router = useRouter();

  const initialSourceKind = props.initial?.sourceKind ?? "manual";
  const lockedSource = initialSourceKind !== "manual" && Boolean(props.initial?.sourceId);

  const [sourceKind, setSourceKind] = useState<PlaybookSourceKind>(initialSourceKind);
  const [sourceId, setSourceId] = useState(props.initial?.sourceId ?? "");
  const [incidentType, setIncidentType] = useState<PlaybookIncidentType>(
    props.initial?.incidentType ?? "vulnerability_exploitation"
  );
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const showIncidentType = useMemo(() => sourceKind === "manual", [sourceKind]);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (sourceKind !== "manual" && !sourceId.trim()) return false;
    if (title && title.length > 180) return false;
    return true;
  }, [busy, sourceKind, sourceId, title]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError("");
    try {
      const body: Record<string, any> = {
        sourceKind,
        sourceId: sourceKind === "manual" ? undefined : sourceId.trim(),
        incidentType: showIncidentType ? incidentType : undefined,
        title: title.trim() || undefined,
      };

      const res = await fetch("/api/playbooks", {
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
      if (!json.id) throw new Error("Playbook creation returned no id");

      router.push(`/p/${props.projectSlug}/playbooks/${json.id}`);
      router.refresh();
    } catch (e2) {
      setError(safeErrorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 shadow-2xl shadow-black/10 dark:shadow-black/40 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Generate playbook</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Produces a draft playbook aligned to NIST incident response phases and injects tool-specific actions for your configured stack.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Source</div>
          <select
            value={sourceKind}
            disabled={busy || lockedSource}
            onChange={(e) => setSourceKind(e.target.value as PlaybookSourceKind)}
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
          >
            <option value="manual">Manual</option>
            <option value="navigator_scenario">Navigator scenario</option>
            <option value="finding">Finding</option>
          </select>
        </label>

        {sourceKind !== "manual" ? (
          <label className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Source id</div>
            <input
              value={sourceId}
              disabled={busy || lockedSource}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="UUID"
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
            {sourceKind === "finding" ? (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Tip: open a Finding profile to copy its UUID (one-click).{" "}
                <a className="underline hover:opacity-90" href="/findings" target="_blank" rel="noreferrer">
                  Open Findings
                </a>
                .
              </div>
            ) : null}
          </label>
        ) : null}
      </div>

      {showIncidentType ? (
        <label className="space-y-1 block">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Incident type</div>
          <select
            value={incidentType}
            disabled={busy}
            onChange={(e) => setIncidentType(e.target.value as PlaybookIncidentType)}
            className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-zinc-500">Template base: {incidentTypeLabel(incidentType)}.</div>
        </label>
      ) : null}

      <label className="space-y-1 block">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Title (optional)</div>
        <input
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave blank to auto-title from intel"
          className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </label>

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
          href={`/p/${props.projectSlug}/playbooks`}
          className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
