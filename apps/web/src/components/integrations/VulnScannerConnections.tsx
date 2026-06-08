"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

type ScannerKind = "tenable" | "qualys" | "rapid7" | "openvas";

type Row = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  baseUrl: string;
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

function isScannerKind(v: string): v is ScannerKind {
  return v === "tenable" || v === "qualys" || v === "rapid7" || v === "openvas";
}

type Form = {
  name: string;
  enabled: boolean;
  kind: ScannerKind;
  baseUrl: string;
  tenable: { accessKey: string; secretKey: string };
  qualys: { username: string; password: string };
  rapid7: { apiKey: string; username: string; password: string };
  openvas: { username: string; password: string };
};

function emptyForm(): Form {
  return {
    name: "Vulnerability Scanner",
    enabled: true,
    kind: "tenable",
    baseUrl: "",
    tenable: { accessKey: "", secretKey: "" },
    qualys: { username: "", password: "" },
    rapid7: { apiKey: "", username: "", password: "" },
    openvas: { username: "", password: "" },
  };
}

function credentialsForSubmit(kind: ScannerKind, form: Form, requireAll: boolean) {
  if (kind === "tenable") {
    const accessKey = form.tenable.accessKey.trim();
    const secretKey = form.tenable.secretKey.trim();
    const any = Boolean(accessKey || secretKey);
    if (!requireAll && !any) return { ok: true as const, credentials: null as any };
    if (!accessKey) return { ok: false as const, error: "Tenable accessKey is required" };
    if (!secretKey) return { ok: false as const, error: "Tenable secretKey is required" };
    return { ok: true as const, credentials: { accessKey, secretKey } };
  }

  if (kind === "qualys") {
    const username = form.qualys.username.trim();
    const password = form.qualys.password;
    const any = Boolean(username || password);
    if (!requireAll && !any) return { ok: true as const, credentials: null as any };
    if (!username) return { ok: false as const, error: "Qualys username is required" };
    if (!password) return { ok: false as const, error: "Qualys password is required" };
    return { ok: true as const, credentials: { username, password } };
  }

  if (kind === "openvas") {
    const username = form.openvas.username.trim();
    const password = form.openvas.password;
    const any = Boolean(username || password);
    if (!requireAll && !any) return { ok: true as const, credentials: null as any };
    if (!username) return { ok: false as const, error: "OpenVAS username is required" };
    if (!password) return { ok: false as const, error: "OpenVAS password is required" };
    return { ok: true as const, credentials: { username, password } };
  }

  // rapid7
  const apiKey = form.rapid7.apiKey.trim();
  const username = form.rapid7.username.trim();
  const password = form.rapid7.password;
  const any = Boolean(apiKey || username || password);
  if (!requireAll && !any) return { ok: true as const, credentials: null as any };
  if (apiKey) return { ok: true as const, credentials: { apiKey } };
  if (!username) return { ok: false as const, error: "Rapid7 username is required (or set apiKey)" };
  if (!password) return { ok: false as const, error: "Rapid7 password is required (or set apiKey)" };
  return { ok: true as const, credentials: { username, password } };
}

export function VulnScannerConnections({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"connections" | "docs">("connections");
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => emptyForm(), []);
  const [form, setForm] = useState<Form>(() => ({ ...defaults }));

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
      kind: isScannerKind(String(r.kind ?? "")) ? (r.kind as ScannerKind) : "tenable",
      baseUrl: r.baseUrl ?? "",
      tenable: { accessKey: "", secretKey: "" },
      qualys: { username: "", password: "" },
      rapid7: { apiKey: "", username: "", password: "" },
      openvas: { username: "", password: "" },
    });
  };

  const save = async () => {
    setError(null);
    setNotice(null);

    const requireAll = !editingId;
    const cred = credentialsForSubmit(form.kind, form, requireAll);
    if (!cred.ok) {
      setError(cred.error);
      return false;
    }

    const payload: any = {
      name: form.name,
      enabled: form.enabled,
      kind: form.kind,
      baseUrl: form.baseUrl,
    };
    if (cred.credentials) payload.credentials = cred.credentials;

    setBusy(editingId ? `upd:${editingId}` : "create");
    try {
      const res = await fetch(editingId ? `/api/integrations/vuln-scanners/${editingId}` : "/api/integrations/vuln-scanners", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      resetForm();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save connection");
      return false;
    } finally {
      setBusy("");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this scanner connection?")) return;
    setBusy(`del:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/integrations/vuln-scanners/${id}`, { method: "DELETE" });
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

  const test = async (id: string) => {
    setBusy(`test:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/vuln-scanners/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setNotice("Test succeeded.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
      return false;
    } finally {
      setBusy("");
    }
  };

  const syncNow = async (id: string) => {
    setBusy(`sync:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "system", agentKey: "vuln-scanners", connectionId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setNotice("Sync queued. Refresh in a few minutes to see lastSyncedAt update.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to queue sync");
      return false;
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Vulnerability Scanners</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Correlate scanner detections to CVE findings (affected hosts, last seen, sample hosts).
          </p>
        </div>

        <div className="flex items-center gap-4">
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

      {tab === "docs" ? (
        <Card>
          <CardHeader title="How it works" description="We sync scanner detections and compute exposure per CVE." />
          <CardContent>
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <p>
                On each sync, we pull host vulnerabilities from your scanner and store a per-CVE cache:
                <span className="font-mono"> affectedHostCount</span> + <span className="font-mono">lastSeenAt</span> + a small{" "}
                sample host list for drilldown.
              </p>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                <div>
                  Tenable base URL example: <span className="font-mono">https://cloud.tenable.com</span>
                </div>
                <div>
                  Qualys base URL example: <span className="font-mono">https://qualysapi.qualys.com</span>
                </div>
                <div>
                  Rapid7 base URL example: <span className="font-mono">https://your-insightvm-console:3780</span>
                </div>
                <div>
                  OpenVAS base URL example: <span className="font-mono">https://your-greenbone-gsa:9392</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Note: Edge runtime can’t bypass self-signed TLS certs for test calls. Use a trusted cert or HTTP in local/self-hosted setups.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={editingId ? "Edit connection" : "New connection"}
              description="Credentials are encrypted at rest (requires TI_SECRETS_KEY)."
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
                    placeholder="Vulnerability Scanner"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Provider</div>
                  <select
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm"
                    value={form.kind}
                    onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ScannerKind }))}
                  >
                    <option value="tenable">Tenable</option>
                    <option value="qualys">Qualys</option>
                    <option value="rapid7">Rapid7</option>
                    <option value="openvas">OpenVAS (GVM)</option>
                  </select>
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
                    placeholder={
                      form.kind === "tenable"
                        ? "https://cloud.tenable.com"
                        : form.kind === "qualys"
                          ? "https://qualysapi.qualys.com"
                          : form.kind === "rapid7"
                            ? "https://your-insightvm-console:3780"
                            : "https://your-greenbone-gsa:9392"
                    }
                  />
                </label>

                {form.kind === "tenable" ? (
                  <>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Access Key</div>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.tenable.accessKey}
                        onChange={(e) => setForm((f) => ({ ...f, tenable: { ...f.tenable, accessKey: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Secret Key</div>
                      <input
                        type="password"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.tenable.secretKey}
                        onChange={(e) => setForm((f) => ({ ...f, tenable: { ...f.tenable, secretKey: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                  </>
                ) : null}

                {form.kind === "qualys" ? (
                  <>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Username</div>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.qualys.username}
                        onChange={(e) => setForm((f) => ({ ...f, qualys: { ...f.qualys, username: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Password</div>
                      <input
                        type="password"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.qualys.password}
                        onChange={(e) => setForm((f) => ({ ...f, qualys: { ...f.qualys, password: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                  </>
                ) : null}

                {form.kind === "openvas" ? (
                  <>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Username</div>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.openvas.username}
                        onChange={(e) => setForm((f) => ({ ...f, openvas: { ...f.openvas, username: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Password</div>
                      <input
                        type="password"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.openvas.password}
                        onChange={(e) => setForm((f) => ({ ...f, openvas: { ...f.openvas, password: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                  </>
                ) : null}

                {form.kind === "rapid7" ? (
                  <>
                    <label className="space-y-1 md:col-span-2">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">API Key (optional)</div>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.rapid7.apiKey}
                        onChange={(e) => setForm((f) => ({ ...f, rapid7: { ...f.rapid7, apiKey: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        If unset, we fall back to username/password.
                      </div>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Username (optional)</div>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.rapid7.username}
                        onChange={(e) => setForm((f) => ({ ...f, rapid7: { ...f.rapid7, username: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Password (optional)</div>
                      <input
                        type="password"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-mono"
                        value={form.rapid7.password}
                        onChange={(e) => setForm((f) => ({ ...f, rapid7: { ...f.rapid7, password: e.target.value } }))}
                        placeholder={editingId ? "Leave blank to keep current" : ""}
                      />
                    </label>
                  </>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== ""}
                  className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                  onClick={save}
                >
                  {editingId ? "Save" : "Create"}
                </button>

                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {editingId ? "Tip: leave credential fields empty to keep stored secrets." : null}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Connections" description="Enabled connections are synced by the vuln-scanners agent." />
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                    <tr>
                      <th className="text-left font-medium py-2 pr-4">Name</th>
                      <th className="text-left font-medium py-2 pr-4">Provider</th>
                      <th className="text-left font-medium py-2 pr-4">Base URL</th>
                      <th className="text-left font-medium py-2 pr-4">Last sync</th>
                      <th className="text-left font-medium py-2 pr-4">Status</th>
                      <th className="text-right font-medium py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                    {rows.length ? (
                      rows.map((r) => (
                        <tr key={r.id} className="align-top">
                          <td className="py-3 pr-4">
                            <button
                              type="button"
                              className="text-zinc-900 dark:text-zinc-100 hover:underline text-left"
                              onClick={() => startEdit(r)}
                            >
                              {r.name}
                            </button>
                          </td>
                          <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{r.kind}</td>
                          <td className="py-3 pr-4 text-xs font-mono text-zinc-600 dark:text-zinc-400">{r.baseUrl}</td>
                          <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{fmtWhen(r.lastSyncedAt)}</td>
                          <td className="py-3 pr-4">
                            {r.enabled ? (
                              <span className="text-xs rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 px-2 py-0.5">
                                Enabled
                              </span>
                            ) : (
                              <span className="text-xs rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                                Disabled
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-2 flex-wrap">
                              <button
                                type="button"
                                className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline disabled:opacity-60"
                                disabled={busy !== ""}
                                onClick={() => test(r.id)}
                              >
                                Test
                              </button>
                              <button
                                type="button"
                                className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline disabled:opacity-60"
                                disabled={busy !== ""}
                                onClick={() => syncNow(r.id)}
                              >
                                Sync now
                              </button>
                              <button
                                type="button"
                                className="text-xs text-rose-600 hover:underline disabled:opacity-60"
                                disabled={busy !== ""}
                                onClick={() => del(r.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-6 text-sm text-zinc-600 dark:text-zinc-400">
                          No scanner connections yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
