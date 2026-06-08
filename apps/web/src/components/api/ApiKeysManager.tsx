"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiScope } from "../../lib/api-keys";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  rateLimitPerMin: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function formatIso(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  } catch {
    return "—";
  }
}

function safeParseScopes(scopesJson: string) {
  try {
    const parsed = JSON.parse(scopesJson);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

const SCOPE_OPTIONS: Array<{ id: ApiScope; label: string; hint: string }> = [
  { id: "actors:read", label: "Actors", hint: "Read threat actor profiles" },
  { id: "cves:read", label: "CVEs", hint: "Read CVE profiles + enrichment" },
  { id: "query:run", label: "Query", hint: "Run KQL queries" },
  { id: "playbooks:write", label: "Playbooks", hint: "Create incident response playbooks" },
  { id: "detections:generate", label: "Detections", hint: "Generate navigator detections (Pro)" },
  { id: "findings:read", label: "Findings", hint: "Read findings + CVEs" },
  { id: "navigator:read", label: "Navigator", hint: "Read scenarios + validation" },
  { id: "risk:read", label: "Risk", hint: "Read risk register metrics" },
  { id: "stix:read", label: "STIX", hint: "Download STIX bundles" },
  { id: "taxii:read", label: "TAXII", hint: "TAXII feed endpoints" },
];

export function ApiKeysManager(props: { projectSlug: string }) {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const [name, setName] = useState("API key");
  const [rateLimitPerMin, setRateLimitPerMin] = useState(60);
  const [scopes, setScopes] = useState<ApiScope[]>(["findings:read", "navigator:read", "risk:read", "stix:read", "taxii:read"]);

  const endpoint = useMemo(() => `/api/projects/${encodeURIComponent(props.projectSlug)}/api-keys`, [props.projectSlug]);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch(endpoint, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setError(String(data?.error ?? `Failed to load (${res.status})`));
      return;
    }
    setRows((data?.apiKeys ?? []) as ApiKeyRow[]);
  }, [endpoint]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScope = useCallback((s: ApiScope) => {
    setScopes((prev) => {
      const set = new Set(prev);
      if (set.has(s)) set.delete(s);
      else set.add(s);
      return Array.from(set);
    });
  }, []);

  const createKey = useCallback(async () => {
    setBusy(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, rateLimitPerMin, scopes }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setError(String(data?.error ?? `Failed to create (${res.status})`));
        return;
      }
      setCreatedSecret(String(data?.secret ?? ""));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [endpoint, name, rateLimitPerMin, refresh, scopes]);

  const revoke = useCallback(
    async (id: string) => {
      if (!confirm("Revoke this API key? This cannot be undone.")) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          setError(String(data?.error ?? `Failed to revoke (${res.status})`));
          return;
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [endpoint, refresh]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-4">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Create API key</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              placeholder="e.g. SIEM connector"
            />
          </label>

          <label className="block">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Rate limit (req/min)</div>
            <input
              type="number"
              min={1}
              max={600}
              value={rateLimitPerMin}
              onChange={(e) => setRateLimitPerMin(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 tabular-nums"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={createKey}
              disabled={busy}
              className="w-full rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-50"
            >
              {busy ? "Working…" : "Create"}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
          {SCOPE_OPTIONS.map((s) => {
            const active = scopes.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleScope(s.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-800 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <div className="text-xs font-medium">{s.label}</div>
                <div className={`mt-0.5 text-[11px] ${active ? "opacity-80" : "text-zinc-500"}`}>{s.hint}</div>
              </button>
            );
          })}
        </div>

        {createdSecret ? (
          <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-3">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              Copy this key now — it won’t be shown again.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white/70 dark:bg-black/20 px-2.5 py-2 text-xs font-mono text-emerald-900 dark:text-emerald-100">
                {createdSecret}
              </code>
              <button
                type="button"
                className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white/70 dark:bg-black/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200 hover:bg-white"
                onClick={() => navigator.clipboard.writeText(createdSecret)}
              >
                Copy
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-zinc-600 dark:text-zinc-400 bg-black/[0.02] dark:bg-white/[0.03]">
            <tr>
              <th className="text-left font-medium px-3 py-2">Name</th>
              <th className="text-left font-medium px-3 py-2">Prefix</th>
              <th className="text-left font-medium px-3 py-2">Scopes</th>
              <th className="text-right font-medium px-3 py-2">Req/min</th>
              <th className="text-left font-medium px-3 py-2">Created</th>
              <th className="text-left font-medium px-3 py-2">Last used</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-right font-medium px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
            {rows.length ? (
              rows.map((r) => {
                const scopesLabel = safeParseScopes(r.scopes).join(", ") || "—";
                const revoked = Boolean(r.revokedAt);
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{r.keyPrefix}…</td>
                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{scopesLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.rateLimitPerMin}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIso(r.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIso(r.lastUsedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {revoked ? <span className="text-zinc-500">Revoked</span> : <span className="text-emerald-600 dark:text-emerald-400">Active</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!revoked ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => revoke(r.id)}
                          className="text-xs text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
