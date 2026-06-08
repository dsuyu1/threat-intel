"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "../ui/Card";

function uniq(items: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function normalizeTags(input: string): string[] {
  const tags = input
    .split(/[,\n]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, 100);
  return uniq(tags).slice(0, 50);
}

type Provider = "virustotal" | "shodan";

export function IocDetailActions(props: {
  projectSlug: string;
  iocId: string;
  initialTags: string[];
  techniques?: Array<{ id: string; name: string | null }>;
  actors?: Array<{ id: string; name: string | null }>;
}) {
  const router = useRouter();
  const [tagsText, setTagsText] = useState(props.initialTags.join(", "));
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<null | "tags" | Provider | "detections">(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [queuedScenarioId, setQueuedScenarioId] = useState<string | null>(null);
  const [selectedTechniqueId, setSelectedTechniqueId] = useState<string>(() => props.techniques?.[0]?.id ?? "");

  const tags = useMemo(() => normalizeTags(tagsText), [tagsText]);
  const techniques = props.techniques ?? [];
  const actors = props.actors ?? [];

  const saveTags = async () => {
    setBusy("tags");
    setError(null);
    setQueuedScenarioId(null);
    try {
      const res = await fetch(`/api/iocs/${props.iocId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ tags }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const enrich = async (provider: Provider) => {
    setBusy(provider);
    setError(null);
    setQueuedScenarioId(null);
    try {
      const res = await fetch(`/api/iocs/${props.iocId}/enrich`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ provider, force }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const queueDetections = async () => {
    const techniqueId = String(selectedTechniqueId ?? "").trim();
    if (!techniqueId) {
      setError("Select a technique first.");
      return;
    }

    setBusy("detections");
    setError(null);
    setQueuedScenarioId(null);
    try {
      const res = await fetch(`/api/iocs/${props.iocId}/detections`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ techniqueId, formats: ["sigma", "kql", "spl"] }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
      setQueuedScenarioId(data?.scenarioId ? String(data.scenarioId) : null);
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Actions" description="Update tags and request on-demand enrichment." />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block md:col-span-2">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Tags</div>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              disabled={busy !== null}
              placeholder="ransomware, phish, c2"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
            <div className="mt-1 text-[11px] text-zinc-500">
              {tags.length ? `${tags.length} tag${tags.length === 1 ? "" : "s"}` : "No tags"}
            </div>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void saveTags()}
              disabled={busy !== null}
              className="w-full inline-flex justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              {busy === "tags" ? "Saving..." : "Save tags"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy !== null} />
            Force refresh
          </label>
          <button
            type="button"
            onClick={() => void enrich("virustotal")}
            disabled={busy !== null}
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
          >
            {busy === "virustotal" ? "Queueing..." : "Enrich with VirusTotal"}
          </button>
          <button
            type="button"
            onClick={() => void enrich("shodan")}
            disabled={busy !== null}
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
          >
            {busy === "shodan" ? "Queueing..." : "Enrich with Shodan"}
          </button>

          <div className="ml-auto min-w-0">
            {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
            {!error && queuedScenarioId ? (
              <div className="text-[11px] text-zinc-500">
                Detections queued.{" "}
                <Link href={`/p/${props.projectSlug}/navigator/scenarios/${queuedScenarioId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                  Open scenario
                </Link>
              </div>
            ) : null}
            {!error && savedAt && !queuedScenarioId ? <div className="text-[11px] text-zinc-500">Updated {new Date(savedAt).toLocaleTimeString()}</div> : null}
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Detection engineering</div>

          {techniques.length ? (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <label className="block sm:flex-1 min-w-0">
                <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Mapped technique</div>
                <select
                  value={selectedTechniqueId}
                  onChange={(e) => setSelectedTechniqueId(e.target.value)}
                  disabled={busy !== null}
                  className="mt-1 w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  {techniques.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name ? `${t.id} — ${t.name}` : t.id}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void queueDetections()}
                disabled={busy !== null}
                className="h-9 inline-flex justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
              >
                {busy === "detections" ? "Queueing..." : "Queue detections"}
              </button>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">
              No mapped techniques yet. Import TAXII relationships (indicator indicates attack-pattern) to map IOC → TTP.
            </div>
          )}

          {actors.length ? (
            <div className="text-[11px] text-zinc-500">
              Related actors:{" "}
              {actors.slice(0, 6).map((a, idx) => (
                <span key={a.id}>
                  {idx ? ", " : ""}
                  <Link href={`/actors/${a.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                    {a.name ? `${a.name} (${a.id})` : a.id}
                  </Link>
                </span>
              ))}
              {actors.length > 6 ? <span> …</span> : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
