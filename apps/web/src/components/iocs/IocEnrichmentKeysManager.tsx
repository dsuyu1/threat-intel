"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Provider = "virustotal" | "shodan";

type KeyRow = {
  id: string;
  provider: string;
  enabled: boolean;
  updatedAt: string | Date | null;
};

function fmtDateTime(d: string | Date | null) {
  if (!d) return "—";
  try {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function IocEnrichmentKeysManager(props: { projectSlug: string; initialKeys: KeyRow[] }) {
  const router = useRouter();
  const initial = useMemo(() => {
    const byProvider = new Map<string, KeyRow>();
    for (const k of props.initialKeys) byProvider.set(String(k.provider), k);
    return byProvider;
  }, [props.initialKeys]);

  const [vtEnabled, setVtEnabled] = useState<boolean>(initial.get("virustotal")?.enabled ?? false);
  const [vtKey, setVtKey] = useState("");
  const [shodanEnabled, setShodanEnabled] = useState<boolean>(initial.get("shodan")?.enabled ?? false);
  const [shodanKey, setShodanKey] = useState("");

  const [busy, setBusy] = useState<Provider | "validate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (provider: Provider) => {
    setBusy(provider);
    setError(null);
    setNote(null);

    const enabled = provider === "virustotal" ? vtEnabled : shodanEnabled;
    const apiKey = provider === "virustotal" ? vtKey : shodanKey;

    try {
      const res = await fetch("/api/iocs/enrichment-keys", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ provider, enabled, apiKey }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      if (provider === "virustotal") setVtKey("");
      if (provider === "shodan") setShodanKey("");
      setNote("Saved");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const validate = async (provider: Provider) => {
    setBusy("validate");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/iocs/enrichment-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ provider }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setNote(`Key OK (${provider})`);
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const vtRow = initial.get("virustotal") ?? null;
  const shodanRow = initial.get("shodan") ?? null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">VirusTotal</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {vtRow ? `Last updated: ${fmtDateTime(vtRow.updatedAt)}` : "Not configured yet"}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={vtEnabled} onChange={(e) => setVtEnabled(e.target.checked)} disabled={busy !== null} />
              Enabled
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">API key</div>
            <input
              type="password"
              value={vtKey}
              onChange={(e) => setVtKey(e.target.value)}
              disabled={busy !== null}
              placeholder={vtRow ? "•••••••• (leave blank to keep existing)" : "Paste your key"}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save("virustotal")}
              disabled={busy !== null}
              className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              {busy === "virustotal" ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void validate("virustotal")}
              disabled={busy !== null || !vtRow?.enabled}
              className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              Validate
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Shodan</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {shodanRow ? `Last updated: ${fmtDateTime(shodanRow.updatedAt)}` : "Not configured yet"}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={shodanEnabled} onChange={(e) => setShodanEnabled(e.target.checked)} disabled={busy !== null} />
              Enabled
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">API key</div>
            <input
              type="password"
              value={shodanKey}
              onChange={(e) => setShodanKey(e.target.value)}
              disabled={busy !== null}
              placeholder={shodanRow ? "•••••••• (leave blank to keep existing)" : "Paste your key"}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save("shodan")}
              disabled={busy !== null}
              className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              {busy === "shodan" ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void validate("shodan")}
              disabled={busy !== null || !shodanRow?.enabled}
              className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              Validate
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
      {!error && note ? <div className="text-sm text-emerald-700 dark:text-emerald-300">{note}</div> : null}
    </div>
  );
}
