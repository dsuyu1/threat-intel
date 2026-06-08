"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SourceType = "rss" | "stix";

type ApiResult = { ok: true; source: { id: string; url: string } } | { error: string; existingId?: string };

function pctToUnit(pct: number) {
  if (!Number.isFinite(pct)) return null;
  const n = Math.max(0, Math.min(100, pct));
  return Math.round(n) / 100;
}

export function NewSourceForm() {
  const router = useRouter();

  const [type, setType] = useState<SourceType>("rss");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [reliabilityPct, setReliabilityPct] = useState<number>(90);
  const [reliabilityTouched, setReliabilityTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reliabilityHint = useMemo(() => {
    if (type === "stix") return "Defaults to 100% for STIX/TAXII feeds.";
    return "Defaults to 90% for RSS feeds.";
  }, [type]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const reliability = pctToUnit(reliabilityPct);
      const payload = {
        type,
        url: url.trim(),
        name: name.trim() || undefined,
        enabled,
        reliability: reliability ?? undefined,
      };

      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as ApiResult | null;
      if (!res.ok) {
        setError(data && "error" in data ? data.error : "Failed to create source");
        return;
      }

      router.push("/data/sources");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create source");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Source type</div>
          <select
            value={type}
            onChange={(e) => {
              const next = (e.target.value === "stix" ? "stix" : "rss") as SourceType;
              setType(next);
              if (!reliabilityTouched) setReliabilityPct(next === "stix" ? 100 : 90);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="rss">RSS feed</option>
            <option value="stix">STIX / TAXII endpoint</option>
          </select>
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Enabled</div>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {enabled ? "Enabled (agents will ingest this source)" : "Disabled (ignored by agents)"}
            </span>
          </div>
        </label>
      </div>

      <label className="block">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">URL</div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={type === "stix" ? "https://example.com/taxii/" : "https://example.com/feed.xml"}
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          required
        />
        <div className="mt-1 text-xs text-zinc-500">
          Must be an <span className="font-mono">http(s)</span> URL.
        </div>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Display name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional (defaults to hostname)"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Reliability</div>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={reliabilityPct}
              onChange={(e) => {
                setReliabilityTouched(true);
                setReliabilityPct(Number(e.target.value));
              }}
              className="w-28 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">%</span>
            <span className="text-xs text-zinc-500">{reliabilityHint}</span>
          </div>
        </label>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/60 text-white px-4 py-2 text-sm font-medium"
        >
          {submitting ? "Creating…" : "Create source"}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => router.push("/data/sources")}
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm hover:bg-white dark:hover:bg-black/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

