"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type SourceType = "rss" | "stix";

type ApiResponse =
  | { ok: true; source: { id: string } }
  | { error: string };

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function parseReliability(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export function AddSourceForm() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [type, setType] = useState<SourceType>("rss");
  const [url, setUrl] = useState("");
  const [reliability, setReliability] = useState("0.90");
  const [enabled, setEnabled] = useState(true);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!url.trim()) return false;
    const r = parseReliability(reliability.trim());
    if (r == null) return false;
    return true;
  }, [busy, url, reliability]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          type,
          url: url.trim(),
          reliability: parseReliability(reliability.trim()),
          enabled,
        }),
      });

      const body = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !body || !("ok" in body) || !body.ok) {
        const msg = body && "error" in body ? body.error : `Request failed (${res.status})`;
        throw new Error(msg);
      }

      setNotice("Source added");
      window.setTimeout(() => router.push("/data/sources"), 350);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      <label className="block">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">Name (optional)</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. MS-ISAC Alerts"
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Type</div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value === "stix" ? "stix" : "rss")}
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          >
            <option value="rss">rss</option>
            <option value="stix">stix</option>
          </select>
        </label>

        <label className="block">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">Reliability (0–1)</div>
          <input
            value={reliability}
            onChange={(e) => setReliability(e.target.value)}
            inputMode="decimal"
            placeholder="0.90"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm tabular-nums outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
          <div className="mt-1 text-[11px] text-zinc-500">
            Curated trust weight used in KG evidence scoring (not based on uptime/parse success).
          </div>
        </label>

        <label className="flex items-end gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-zinc-800 dark:text-zinc-100">Enabled</span>
        </label>
      </div>

      <label className="block">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">URL</div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/feed.xml"
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm tabular-nums outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          Add source
        </button>
        <a
          href="/data/sources"
          className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm hover:bg-white dark:hover:bg-black/40"
        >
          Cancel
        </a>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3 text-[11px] text-zinc-600 dark:text-zinc-300">
        Looking for NVD / KEV / MISP / OTX? NVD + KEV are ingested via the system VulnAgent. For API-key-based feeds (e.g.
        MISP), use a custom agent until a native connector lands.
      </div>
    </form>
  );
}
