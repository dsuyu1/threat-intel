"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  username: string;
  app: string;
  owner: string;
  createdAt: string | null;
  updatedAt: string | null;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function maskPassword(pw: string) {
  if (!pw) return "";
  return "\u2022".repeat(8);
}

export function SplunkConnections({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"connections" | "docs">("connections");
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => {
    return {
      name: `Navigator \u2192 Splunk`,
      enabled: true,
      baseUrl: "",
      username: "",
      password: "",
      app: "search",
      owner: "nobody",
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
      username: r.username ?? "",
      password: "",
      app: r.app ?? "search",
      owner: r.owner ?? "nobody",
    });
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/splunk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          enabled: form.enabled,
          baseUrl: form.baseUrl,
          username: form.username,
          password: form.password,
          app: form.app,
          owner: form.owner,
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
      const res = await fetch(`/api/integrations/splunk/${id}`, {
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
      username: form.username,
      app: form.app,
      owner: form.owner,
    };
    if (form.password) patch.password = form.password;
    const ok = await update(editingId, patch);
    if (ok) resetForm();
    return ok;
  };

  const del = async (id: string) => {
    if (!confirm("Delete this Splunk connection?")) return;
    setBusy(`del:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/integrations/splunk/${id}`, { method: "DELETE" });
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

  const test = async (params: { id?: string; baseUrl?: string; username?: string; password?: string }) => {
    setBusy(`test:${params.id ?? "form"}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/splunk/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      const s = data?.server ?? null;
      const suffix = s?.version ? ` (v${s.version}${s.build ? ` build ${s.build}` : ""})` : "";
      setNotice(`Connected${suffix}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      return false;
    } finally {
      setBusy("");
    }
  };

  const testCurrent = async () => {
    if (editingId && !form.password) return test({ id: editingId });
    return test({ baseUrl: form.baseUrl, username: form.username, password: form.password });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Splunk</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect Splunk Enterprise (REST API) to push generated SPL detections as saved searches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={
              tab === "connections"
                ? "text-sm font-medium text-zinc-900 dark:text-zinc-100"
                : "text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }
            onClick={() => setTab("connections")}
          >
            Connections
          </button>
          <button
            type="button"
            className={
              tab === "docs"
                ? "text-sm font-medium text-zinc-900 dark:text-zinc-100"
                : "text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }
            onClick={() => setTab("docs")}
          >
            Docs
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      {tab === "connections" ? (
        <>
          <Card>
            <CardHeader
              title={editingId ? "Edit connection" : "New connection"}
              description="Uses Splunk user auth (username/password) to obtain a session key and call the REST API."
              right={
                editingId ? (
                  <button
                    type="button"
                    className="text-sm text-zinc-600 dark:text-zinc-300 hover:underline"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null
              }
            />
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Name</div>
                  <input
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={`Navigator \u2192 Splunk`}
                  />
                </label>

                <label className="flex items-center gap-2 mt-6">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">Enabled</span>
                </label>

                <label className="space-y-1 md:col-span-2">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Base URL</div>
                  <input
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://splunk.example.com:8089"
                  />
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use the Splunk management port (default 8089).
                  </div>
                </label>

                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Username</div>
                  <input
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="admin"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Password</div>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={editingId ? maskPassword("x") : ""}
                  />
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {editingId ? "Leave blank to keep the existing password." : "Required to create the connection."}
                  </div>
                </label>

                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">App</div>
                  <input
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                    value={form.app}
                    onChange={(e) => setForm((f) => ({ ...f, app: e.target.value }))}
                    placeholder="search"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Owner</div>
                  <input
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                    value={form.owner}
                    onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                    placeholder="nobody"
                  />
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use <span className="font-mono">nobody</span> to create shared objects.
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                  disabled={!!busy}
                  onClick={save}
                >
                  {editingId ? "Save" : "Create"}
                </button>

                <button
                  type="button"
                  className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-60"
                  disabled={!!busy}
                  onClick={testCurrent}
                >
                  Test
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Connections" description="Enable/disable and manage your Splunk connections." />
            <CardContent>
              {rows.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                      <tr>
                        <th className="py-2 text-left font-medium pr-4">On</th>
                        <th className="py-2 text-left font-medium pr-4">Name</th>
                        <th className="py-2 text-left font-medium pr-4">Base URL</th>
                        <th className="py-2 text-left font-medium pr-4">Namespace</th>
                        <th className="py-2 text-left font-medium pr-4">User</th>
                        <th className="py-2 text-left font-medium pr-4">Updated</th>
                        <th className="py-2 text-left font-medium pr-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                      {rows.map((r) => (
                        <tr key={r.id} className="align-top">
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={r.enabled}
                              disabled={busy === `upd:${r.id}`}
                              onChange={(e) => update(r.id, { enabled: e.target.checked })}
                            />
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{r.name}</td>
                          <td className="py-3 pr-4 min-w-[260px] text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="font-mono">{r.baseUrl}</span>
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="font-mono">
                              {r.owner}/{r.app}
                            </span>
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="font-mono">{r.username}</span>
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
                                onClick={() => test({ id: r.id })}
                              >
                                Test
                              </button>

                              <button
                                type="button"
                                className="text-sm text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-60"
                                disabled={busy === `del:${r.id}`}
                                onClick={() => del(r.id)}
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
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No Splunk connections yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Splunk REST API" description="Notes for Splunk Enterprise connection setup." />
          <CardContent>
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Base URL</div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Use your Splunk management endpoint (default <span className="font-mono">:8089</span>), e.g.{" "}
                  <span className="font-mono">https://splunk.example.com:8089</span>.
                </p>
              </div>

              <div className="space-y-1">
	                <div className="font-medium text-zinc-900 dark:text-zinc-100">TLS certificates</div>
	                <p className="text-zinc-600 dark:text-zinc-400">
	                  If Splunk is using a self-signed cert, Next.js Edge runtime can&apos;t bypass TLS errors. Use HTTP for
	                  local dev, or install a trusted TLS cert for your Splunk endpoint.
	                </p>
	              </div>

              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Where detections go</div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Detections are intended to be pushed as saved searches under{" "}
                  <span className="font-mono">/servicesNS/&lt;owner&gt;/&lt;app&gt;/saved/searches</span>. Defaults are{" "}
                  <span className="font-mono">owner=nobody</span> and <span className="font-mono">app=search</span>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
