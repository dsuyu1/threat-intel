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

const SOURCE_KINDS: Array<{ id: SourceKind; label: string; help: string }> = [
  { id: "scenario", label: "Scenario", help: "Maps a single validated Navigator scenario (risk)." },
  { id: "technique", label: "Technique", help: "Maps an ATT&CK technique ID (e.g., T1059)." },
  { id: "mitigation", label: "Mitigation", help: "Maps an ATT&CK mitigation ID (e.g., M1047)." },
];

function normalizeFramework(input: string): Framework {
  const s = String(input ?? "").trim();
  if (s === "cis_v8" || s === "iso_27001") return s;
  return "nist_csf_2";
}

function normalizeSourceKind(input: string): SourceKind {
  const s = String(input ?? "").trim();
  if (s === "technique" || s === "mitigation") return s;
  return "scenario";
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function asKey(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

type ImportItem = {
  framework: Framework;
  sourceKind: SourceKind;
  sourceId: string;
  controlId: string;
  controlTitle?: string | null;
};

function parseImport(text: string): { items: ImportItem[]; errors: string[] } {
  const errors: string[] = [];
  const s = String(text ?? "").trim();
  if (!s) return { items: [], errors: ["Paste CSV or JSON first."] };

  // JSON: array of items OR { items: [...] }
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const obj = JSON.parse(s);
      const raw = Array.isArray(obj) ? obj : Array.isArray((obj as any)?.items) ? (obj as any).items : [];
      const items: ImportItem[] = [];
      for (const it of raw.slice(0, 500)) {
        const framework = normalizeFramework(String((it as any)?.framework ?? ""));
        const sourceKind = normalizeSourceKind(String((it as any)?.sourceKind ?? (it as any)?.source_kind ?? ""));
        const sourceId = String((it as any)?.sourceId ?? (it as any)?.source_id ?? "").trim();
        const controlId = String((it as any)?.controlId ?? (it as any)?.control_id ?? "").trim();
        const controlTitleRaw = (it as any)?.controlTitle ?? (it as any)?.control_title ?? null;
        const controlTitle = controlTitleRaw != null ? String(controlTitleRaw).trim() : null;
        if (!sourceId || !controlId) continue;
        items.push({ framework, sourceKind, sourceId, controlId, controlTitle: controlTitle || null });
      }
      if (!items.length) errors.push("No valid items found in JSON.");
      return { items, errors };
    } catch {
      return { items: [], errors: ["Invalid JSON."] };
    }
  }

  // CSV
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { items: [], errors: ["CSV must include a header row and at least one data row."] };
  const header = parseCsvLine(lines[0] ?? "");
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(asKey(h), i));

  const get = (row: string[], keys: string[]) => {
    for (const k of keys) {
      const i = idx.get(k);
      if (i == null) continue;
      return row[i] ?? "";
    }
    return "";
  };

  const items: ImportItem[] = [];
  for (let lineNo = 1; lineNo < Math.min(lines.length, 501); lineNo++) {
    const row = parseCsvLine(lines[lineNo] ?? "");
    const framework = normalizeFramework(get(row, ["framework"]));
    const sourceKind = normalizeSourceKind(get(row, ["sourcekind", "source_kind"]));
    const sourceId = get(row, ["sourceid", "source_id"]).trim();
    const controlId = get(row, ["controlid", "control_id"]).trim();
    const controlTitle = get(row, ["controltitle", "control_title"]).trim();
    if (!sourceId || !controlId) continue;
    items.push({ framework, sourceKind, sourceId, controlId, controlTitle: controlTitle || null });
  }

  if (!items.length) errors.push("No valid rows found in CSV.");
  return { items, errors };
}

export function ComplianceMappingEditor(props: {
  projectSlug: string;
  defaultSource?: { kind: SourceKind; id: string };
  showBulk?: boolean;
}) {
  const router = useRouter();
  const [framework, setFramework] = useState<Framework>("nist_csf_2");
  const [sourceKind, setSourceKind] = useState<SourceKind>(props.defaultSource?.kind ?? "scenario");
  const [sourceId, setSourceId] = useState<string>(props.defaultSource?.id ?? "");
  const [controlId, setControlId] = useState<string>("");
  const [controlTitle, setControlTitle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [bulk, setBulk] = useState<string>("");
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  const sourceHelp = useMemo(() => SOURCE_KINDS.find((s) => s.id === sourceKind)?.help ?? "", [sourceKind]);
  const showBulk = props.showBulk ?? true;

  const saveOne = async () => {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      const item = {
        framework,
        sourceKind,
        sourceId: sourceId.trim(),
        controlId: controlId.trim(),
        controlTitle: controlTitle.trim() || null,
      };
      if (!item.sourceId || !item.controlId) throw new Error("Source ID and Control ID are required.");

      const res = await fetch("/api/risk/compliance/mappings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ items: [item] }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
      setControlId("");
      setControlTitle("");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const importBulk = async () => {
    setBusy(true);
    setError(null);
    setBulkStatus(null);
    try {
      const parsed = parseImport(bulk);
      if (parsed.errors.length) throw new Error(parsed.errors[0]);
      const res = await fetch("/api/risk/compliance/mappings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ items: parsed.items }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setBulkStatus(`Imported ${data?.imported ?? parsed.items.length} mappings.`);
      setBulk("");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={showBulk ? "space-y-6" : "space-y-4"}>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <label className="block md:col-span-1">
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

        <label className="block md:col-span-1">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Source kind</div>
          <select
            value={sourceKind}
            onChange={(e) => setSourceKind(normalizeSourceKind(e.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {SOURCE_KINDS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {sourceHelp ? <div className="mt-1 text-[11px] text-zinc-500">{sourceHelp}</div> : null}
        </label>

        <label className="block md:col-span-1">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Source ID</div>
          <input
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={busy}
            placeholder={sourceKind === "scenario" ? "Navigator scenario ID" : sourceKind === "technique" ? "T1059" : "M1047"}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>

        <label className="block md:col-span-1">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Control ID</div>
          <input
            value={controlId}
            onChange={(e) => setControlId(e.target.value)}
            disabled={busy}
            placeholder={framework === "nist_csf_2" ? "GV.OC-01" : framework === "cis_v8" ? "5.1" : "A.5.1"}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </label>

        <label className="block md:col-span-1">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Control title (optional)</div>
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
          onClick={() => void saveOne()}
          disabled={busy}
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Add mapping"}
        </button>
      </div>

      {showBulk ? (
        <div className="pt-4 border-t border-zinc-200/70 dark:border-zinc-800/80">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Bulk import</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Paste CSV (with headers) or JSON. Required fields: framework, sourceKind, sourceId, controlId. Optional:
            controlTitle.
          </div>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            disabled={busy}
            rows={7}
            placeholder={`CSV example:\nframework,sourceKind,sourceId,controlId,controlTitle\nnist_csf_2,technique,T1059,PR.AA-01,Identity management\n\nJSON example:\n[{\"framework\":\"cis_v8\",\"sourceKind\":\"scenario\",\"sourceId\":\"<scenarioId>\",\"controlId\":\"3.5\"}]`}
            className="mt-3 w-full resize-y rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              {bulkStatus ? <div className="text-xs text-emerald-700 dark:text-emerald-300">{bulkStatus}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulk("")}
                disabled={busy || !bulk.trim()}
                className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void importBulk()}
                disabled={busy || !bulk.trim()}
                className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
              >
                {busy ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
