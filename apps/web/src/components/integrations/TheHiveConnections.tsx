"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  authScheme: string;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TheHiveConnections({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"connections" | "docs">("connections");
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => {
    return {
      name: "TheHive",
      enabled: true,
      baseUrl: "",
      apiKey: "",
    };
  }, []);

  const [form, setForm] = useState(() => ({ ...defaults }));

  const resetForm = () => {
    setEditingId(null);
    setError(null);
    setNotice(null);
    setForm({ ...defaults });
  };

  const startEdit = (r: Row) => {
    if (editingId && editingId !== r.id) {
      if (!confirm("Discard unsaved changes and edit a different connection?")) return;
    }
    setTab("connections");
    setEditingId(r.id);
    setError(null);
    setNotice(null);
    setForm({
      name: r.name ?? "",
      enabled: !!r.enabled,
      baseUrl: r.baseUrl ?? "",
      apiKey: "",
    });
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/thehive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          enabled: form.enabled,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      resetForm();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create connection");
      return false;
    } finally {
      setBusy("");
    }
  };

  const update = async (id: string, patch: any) => {
    setBusy(`upd:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/integrations/thehive/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update connection");
      return false;
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!editingId) return create();
    const patch: any = {
      name: form.name,
      enabled: form.enabled,
      baseUrl: form.baseUrl,
    };
    if (form.apiKey) patch.apiKey = form.apiKey;
    const ok = await update(editingId, patch);
    if (ok) resetForm();
    return ok;
  };

  const del = async (id: string) => {
    if (!confirm("Delete this TheHive connection?")) return;
    setBusy(`del:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/integrations/thehive/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      if (editingId === id) resetForm();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete connection");
      return false;
    } finally {
      setBusy("");
    }
  };

  const test = async (params: { id?: string; baseUrl?: string; apiKey?: string }) => {
    setBusy(`test:${params.id ?? "draft"}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/thehive/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setNotice(data?.message ? String(data.message) : "Connection OK");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      return false;
    } finally {
      setBusy("");
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await save();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">TheHive</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Sync cases into the platform to measure MTTD/MTTR/time-to-contain and track playbook outcomes.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            className={`h-9 rounded-lg px-3 text-sm transition-colors ${
              tab === "connections"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
            }`}
            onClick={() => setTab("connections")}
          >
            Connections
          </button>
          <button
            type="button"
            className={`h-9 rounded-lg px-3 text-sm transition-colors ${
              tab === "docs"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
            }`}
            onClick={() => setTab("docs")}
          >
            Docs
          </button>
        </div>
      </div>

      {tab === "connections" ? (
        <>
          <Card>
            <CardHeader
              title={editingId ? "Edit connection" : "Add connection"}
              description="Stored encrypted; used by the agents service for polling."
              right={
                editingId ? (
                  <button
                    type="button"
                    className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
                    onClick={() => resetForm()}
                    disabled={!!busy}
                  >
                    Cancel
                  </button>
                ) : null
              }
            />
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Name</div>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm"
                      placeholder="TheHive"
                    />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Base URL</div>
                    <input
                      value={form.baseUrl}
                      onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm font-mono"
                      placeholder="https://thehive.example.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">
                      API key {editingId ? <span className="normal-case">(leave blank to keep)</span> : null}
                    </div>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm font-mono"
                      placeholder={editingId ? "••••••••" : ""}
                    />
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Sent as <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        className="h-9 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 disabled:opacity-60"
                        disabled={busy === `test:${editingId ?? "draft"}`}
                        onClick={() =>
                          void test(
                            editingId ? { id: editingId } : { baseUrl: form.baseUrl, apiKey: form.apiKey }
                          )
                        }
                      >
                        Test
                      </button>
                      <button
                        type="submit"
                        className="h-9 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                        disabled={!!busy}
                      >
                        {editingId ? "Save" : "Create"}
                      </button>
                    </div>
                  </div>
                </div>

                {notice ? <div className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</div> : null}
                {error ? <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Connections" description="Project-scoped TheHive endpoints." />
            <CardContent>
              {rows.length ? (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500">
                        <th className="py-2 pr-4 font-medium">On</th>
                        <th className="py-2 pr-4 font-medium">Name</th>
                        <th className="py-2 pr-4 font-medium">Base URL</th>
                        <th className="py-2 pr-4 font-medium">Last sync</th>
                        <th className="py-2 pr-4 font-medium">Updated</th>
                        <th className="py-2 pr-4 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="py-3 pr-4">
                            <input
                              type="checkbox"
                              checked={!!r.enabled}
                              disabled={busy === `upd:${r.id}`}
                              onChange={(e) => void update(r.id, { enabled: e.target.checked })}
                            />
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{r.name}</td>
                          <td className="py-3 pr-4 min-w-[260px] text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="font-mono">{r.baseUrl}</span>
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            {fmtWhen(r.lastSyncedAt)}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            {fmtWhen(r.updatedAt ?? r.createdAt)}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                className="text-sm text-zinc-700 dark:text-zinc-200 hover:underline disabled:opacity-60"
                                disabled={!!busy || editingId === r.id}
                                onClick={() => startEdit(r)}
                              >
                                {editingId === r.id ? "Editing" : "Edit"}
                              </button>

                              <button
                                type="button"
                                className="text-sm text-zinc-700 dark:text-zinc-200 hover:underline disabled:opacity-60"
                                disabled={busy === `test:${r.id}`}
                                onClick={() => void test({ id: r.id })}
                              >
                                Test
                              </button>

                              <button
                                type="button"
                                className="text-sm text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-60"
                                disabled={busy === `del:${r.id}`}
                                onClick={() => void del(r.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No TheHive connections yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="TheHive mapping" description="Fields expected for incident metrics and reviews." />
          <CardContent>
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Incident type</div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Add a custom field <span className="font-mono">ti_incident_type</span> containing one of:
                </p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`vulnerability_exploitation
credential_compromise
ransomware
supply_chain
lateral_movement
data_exfiltration`}</pre>
              </div>

              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Timestamps</div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Metrics are computed from TheHive case lifecycle + 2 custom fields:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-zinc-600 dark:text-zinc-400">
                  <li>
                    MTTD = <span className="font-mono">createdAt - startDate</span>
                  </li>
                  <li>
                    MTTR = <span className="font-mono">ti_responded_at - createdAt</span>
                  </li>
                  <li>
                    Time-to-contain = <span className="font-mono">ti_contained_at - createdAt</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Custom fields</div>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`ti_incident_type: string
ti_responded_at: timestamp
ti_contained_at: timestamp`}</pre>
              </div>

              <div className="text-[11px] text-zinc-500">
                Notes: The sync agent polls TheHive periodically and upserts cases into the platform.
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

