"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AuthScheme = "none" | "bearer" | "basic";

type ConnectionRow = {
  id: string;
  name: string;
  enabled: boolean;
  apiRootUrl: string;
  collectionId: string;
  authScheme: string;
  username: string | null;
  lookbackDays: number;
  lastSyncedAt: string | Date | null;
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

function clampDays(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

export function TaxiiConnectionsManager(props: { projectSlug: string; initialConnections: ConnectionRow[] }) {
  const router = useRouter();
  const initial = useMemo(() => props.initialConnections ?? [], [props.initialConnections]);

  const [name, setName] = useState("OpenCTI");
  const [apiRootUrl, setApiRootUrl] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [authScheme, setAuthScheme] = useState<AuthScheme>("none");
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lookbackDays, setLookbackDays] = useState(30);
  const [enabled, setEnabled] = useState(true);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const createOrUpdate = async () => {
    setBusy("create");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/iocs/taxii-connections", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          name,
          enabled,
          apiRootUrl,
          collectionId,
          authScheme,
          apiKey: authScheme === "bearer" ? apiKey : "",
          username: authScheme === "basic" ? username : "",
          password: authScheme === "basic" ? password : "",
          lookbackDays,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setApiKey("");
      setPassword("");
      setNote("Saved");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const updateRow = async (id: string, patch: { enabled?: boolean; lookbackDays?: number }) => {
    setBusy(id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/iocs/taxii-connections", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setNote("Updated");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4 space-y-3">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add connection</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy !== null}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">API root URL</div>
            <input
              value={apiRootUrl}
              onChange={(e) => setApiRootUrl(e.target.value)}
              disabled={busy !== null}
              placeholder="https://opencti.example.com/taxii2/root"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Collection ID</div>
            <input
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              disabled={busy !== null}
              placeholder="collection id"
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Auth</div>
            <select
              value={authScheme}
              onChange={(e) => setAuthScheme(e.target.value as AuthScheme)}
              disabled={busy !== null}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="basic">Basic auth</option>
            </select>
          </label>

          {authScheme === "bearer" ? (
            <label className="block md:col-span-2">
              <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Bearer token</div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={busy !== null}
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
              <div className="mt-1 text-[11px] text-zinc-500">Stored encrypted. Leave blank only if you are rotating via a re-save.</div>
            </label>
          ) : null}

          {authScheme === "basic" ? (
            <>
              <label className="block">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Username</div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy !== null}
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="block">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Password</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy !== null}
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </label>
            </>
          ) : null}

          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Lookback days</div>
            <input
              type="number"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(clampDays(e.target.value))}
              disabled={busy !== null}
              className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>

          <div className="flex items-end justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy !== null} />
              Enabled
            </label>
            <button
              type="button"
              onClick={() => void createOrUpdate()}
              disabled={busy !== null}
              className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
            >
              {busy === "create" ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div className="text-[11px] text-zinc-500">
          Tip: to rotate credentials, re-save a connection with the same name (it upserts by project+name).
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Existing connections</div>
        {initial.length ? (
          <div className="space-y-2">
            {initial.map((c) => (
              <div key={c.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.name}</div>
                    <div className="mt-1 text-[11px] text-zinc-500 break-all">{c.apiRootUrl}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      collection: <span className="tabular-nums">{c.collectionId}</span> • auth: {c.authScheme}
                      {c.username ? ` (${c.username})` : ""} • lookback: {c.lookbackDays}d
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      last sync: {fmtDateTime(c.lastSyncedAt)} • updated: {fmtDateTime(c.updatedAt)}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={!!c.enabled}
                        onChange={(e) => void updateRow(c.id, { enabled: e.target.checked })}
                        disabled={busy !== null}
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => void updateRow(c.id, { lookbackDays: c.lookbackDays })}
                      disabled={busy !== null}
                      className="hidden"
                    >
                      Save
                    </button>
                  </div>
                </div>
                {busy === c.id ? <div className="mt-2 text-[11px] text-zinc-500">Updating...</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">No TAXII connections yet.</div>
        )}
      </div>

      {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
      {!error && note ? <div className="text-sm text-emerald-700 dark:text-emerald-300">{note}</div> : null}
    </div>
  );
}

