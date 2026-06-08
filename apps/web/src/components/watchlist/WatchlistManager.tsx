"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

export type WatchlistConnectionOption = {
  id: string;
  kind: "slack" | "discord" | "soar";
  name: string;
  enabled: boolean;
};

export type WatchlistRow = {
  id: string;
  enabled: boolean;
  kind: "cve" | "technique" | "actor";
  value: string;
  label: string;
  channel: "slack" | "discord" | "soar" | "email";
  connectionId: string | null;
  connectionLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function WatchlistManager({
  projectSlug,
  rows,
  connections,
}: {
  projectSlug: string;
  rows: WatchlistRow[];
  connections: WatchlistConnectionOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connectionOptions = useMemo(() => {
    const byKind: Record<string, WatchlistConnectionOption[]> = { slack: [], discord: [], soar: [] };
    for (const c of connections) byKind[c.kind].push(c);
    for (const k of Object.keys(byKind)) byKind[k]!.sort((a, b) => a.name.localeCompare(b.name));
    return byKind as Record<"slack" | "discord" | "soar", WatchlistConnectionOption[]>;
  }, [connections]);

  const [form, setForm] = useState(() => ({
    kind: "cve" as WatchlistRow["kind"],
    value: "",
    channel: "slack" as WatchlistRow["channel"],
    connectionId: "",
  }));

  const canSelectConnection = form.channel !== "email";

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const payload: any = {
        kind: form.kind,
        value: form.value,
        channel: form.channel,
      };
      if (canSelectConnection) payload.connectionId = form.connectionId;

      const res = await fetch("/api/watchlist/items", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);

      setForm((s) => ({ ...s, value: "" }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create watchlist item");
    } finally {
      setBusy("");
    }
  };

  const updateEnabled = async (id: string, enabled: boolean) => {
    setBusy(`upd:${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": projectSlug },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update item");
    } finally {
      setBusy("");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Remove this watchlist item?")) return;
    setBusy(`del:${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist/items/${id}`, {
        method: "DELETE",
        headers: { "x-ti-project-slug": projectSlug },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete item");
    } finally {
      setBusy("");
    }
  };

  const channelConns = canSelectConnection ? connectionOptions[form.channel as any] ?? [] : [];
  const needsConnection = canSelectConnection && channelConns.length > 0;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Watchlist</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pin actors, CVEs, or ATT&amp;CK techniques. When a new finding matches, we notify your selected channel.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Add item" description="Choose what to track and where to send alerts." />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">Kind</label>
              <select
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                value={form.kind}
                onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value as any }))}
              >
                <option value="cve">CVE</option>
                <option value="technique">MITRE technique</option>
                <option value="actor">Threat actor</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                Value{" "}
                <span className="text-zinc-500">
                  {form.kind === "cve" ? "(CVE-YYYY-NNNN)" : form.kind === "technique" ? "(T#### or T####.###)" : "(name or ID)"}
                </span>
              </label>
              <input
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                value={form.value}
                onChange={(e) => setForm((s) => ({ ...s, value: e.target.value }))}
                placeholder={form.kind === "cve" ? "CVE-2024-1234" : form.kind === "technique" ? "T1059" : "FIN7"}
              />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">Channel</label>
              <select
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                value={form.channel}
                onChange={(e) => setForm((s) => ({ ...s, channel: e.target.value as any, connectionId: "" }))}
              >
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="soar">SOAR webhook</option>
                <option value="email">Email</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                Connection {canSelectConnection ? "" : "(not required)"}
              </label>
              {canSelectConnection ? (
                <select
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                  value={form.connectionId}
                  onChange={(e) => setForm((s) => ({ ...s, connectionId: e.target.value }))}
                >
                  <option value="">{channelConns.length ? "Select…" : "No connections found"}</option>
                  {channelConns.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.enabled}>
                      {c.name}
                      {!c.enabled ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="h-10 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 flex items-center text-sm text-zinc-500">
                  Email delivery uses your account email.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={busy === "create" || !form.value.trim() || (needsConnection && !form.connectionId)}
              onClick={create}
              className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
            >
              {busy === "create" ? "Adding…" : "Add to watchlist"}
            </button>
            <div className="text-xs text-zinc-500">
              {needsConnection && !form.connectionId ? "Select a connection first." : " "}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Your items" description="Enable/disable or remove subscriptions." />
        <CardContent>
          {rows.length ? (
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {rows.map((r) => (
                <div key={r.id} className="py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{r.label}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                      <span className="uppercase tracking-wide">{r.kind}</span>
                      <span className="uppercase tracking-wide">{r.channel}</span>
                      {r.connectionLabel ? <span className="truncate">→ {r.connectionLabel}</span> : null}
                      <span className="tabular-nums">Updated: {fmtWhen(r.updatedAt ?? r.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={busy === `upd:${r.id}` || busy === `del:${r.id}`}
                        onChange={(e) => updateEnabled(r.id, e.target.checked)}
                      />
                      Enabled
                    </label>

                    <button
                      type="button"
                      onClick={() => del(r.id)}
                      disabled={busy === `del:${r.id}` || busy === `upd:${r.id}`}
                      className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-sm text-zinc-500">No watchlist items yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

