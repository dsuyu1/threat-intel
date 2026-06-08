"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  recipients: string[];
  frequency: string;
  sendHour: number;
  timezone: string;
  criteria: any;
  lastSentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const AGENTS = ["vuln", "exploit", "attack", "ttp", "malware"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function parseRecipientList(raw: string) {
  const parts = raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const v = p.toLowerCase();
    if (!isEmail(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function EmailDigestConnections({ rows, defaultRecipient }: { rows: Row[]; defaultRecipient: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"connections" | "preview">("connections");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [preview, setPreview] = useState<null | { subject: string; recipients: string[]; windowLabel: string; body: string; count: number }>(null);

  const defaults = useMemo(() => {
    return {
      name: "Daily email digest",
      enabled: true,
      recipients: defaultRecipient,
      frequency: "daily" as "daily" | "weekly",
      sendHour: 8,
      timezone: "UTC",
      agents: ["vuln", "exploit"],
      severities: ["critical", "high"],
      minCvss: 7,
      requireCve: true,
      requireKev: false,
      tagsAny: "",
      tagsAll: "",
    };
  }, [defaultRecipient]);

  const [form, setForm] = useState(() => ({ ...defaults }));

  const resetForm = () => {
    setEditingId(null);
    setError(null);
    setPreview(null);
    setForm({ ...defaults });
  };

  const criteriaPayload = () => {
    return {
      agents: form.agents,
      severities: form.severities,
      minCvss: form.minCvss,
      requireCve: form.requireCve,
      requireKev: form.requireKev,
      tagsAny: form.tagsAny.trim() ? form.tagsAny : undefined,
      tagsAll: form.tagsAll.trim() ? form.tagsAll : undefined,
    };
  };

  const recipientsPayload = () => {
    const parsed = parseRecipientList(form.recipients);
    return parsed.length ? parsed : defaultRecipient ? [defaultRecipient] : [];
  };

  const startEdit = (r: Row) => {
    if (editingId && editingId !== r.id) {
      if (!confirm("Discard unsaved changes and edit a different connection?")) return;
    }
    const c = (r.criteria ?? {}) as any;
    setTab("connections");
    setEditingId(r.id);
    setError(null);
    setPreview(null);
    setForm({
      name: r.name ?? "",
      enabled: !!r.enabled,
      recipients: (r.recipients ?? []).join(", "),
      frequency: (String(r.frequency ?? "daily") === "weekly" ? "weekly" : "daily") as any,
      sendHour: typeof r.sendHour === "number" ? r.sendHour : defaults.sendHour,
      timezone: r.timezone ?? defaults.timezone,
      agents: Array.isArray(c.agents) ? c.agents.map(String) : [],
      severities: Array.isArray(c.severities) ? c.severities.map(String) : [],
      minCvss: typeof c.minCvss === "number" ? c.minCvss : defaults.minCvss,
      requireCve: Boolean(c.requireCve),
      requireKev: Boolean(c.requireKev),
      tagsAny: Array.isArray(c.tagsAny) ? c.tagsAny.join(", ") : typeof c.tagsAny === "string" ? c.tagsAny : "",
      tagsAll: Array.isArray(c.tagsAll) ? c.tagsAll.join(", ") : typeof c.tagsAll === "string" ? c.tagsAll : "",
    });
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/integrations/email-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          enabled: form.enabled,
          recipients: recipientsPayload(),
          frequency: form.frequency,
          sendHour: form.sendHour,
          timezone: form.timezone,
          criteria: criteriaPayload(),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
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
    try {
      const res = await fetch(`/api/integrations/email-digest/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update connection");
      return false;
    } finally {
      setBusy("");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this email digest connection?")) return;
    setBusy(`del:${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/email-digest/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
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

  const save = async () => {
    if (!editingId) return;
    const ok = await update(editingId, {
      name: form.name,
      enabled: form.enabled,
      recipients: recipientsPayload(),
      frequency: form.frequency,
      sendHour: form.sendHour,
      timezone: form.timezone,
      criteria: criteriaPayload(),
    });
    if (ok) resetForm();
  };

  const generatePreview = async () => {
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/integrations/email-digest/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipients: recipientsPayload(),
          frequency: form.frequency,
          criteria: criteriaPayload(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setPreview({
        subject: String(data?.subject ?? "Threat Intel digest"),
        recipients: Array.isArray(data?.recipients) ? data.recipients.map(String) : [],
        windowLabel: String(data?.windowLabel ?? ""),
        body: String(data?.body ?? ""),
        count: typeof data?.count === "number" ? data.count : Number(data?.count ?? 0),
      });
      setTab("preview");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
      return false;
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Email digest</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Configure a daily or weekly digest of findings and preview the message that would be sent.
        </p>
      </header>

      <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-1">
        {[
          ["connections", "Connections"],
          ["preview", "Preview"],
        ].map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as any)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-white/70 dark:hover:bg-black/30"
              }`}
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {tab === "connections" ? (
        <>
          <Card>
            <CardHeader
              title={editingId ? "Edit connection" : "Create connection"}
              description={
                editingId ? "Update recipients, schedule, and criteria, then save changes." : "Choose recipients, schedule, and criteria."
              }
            />
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs text-zinc-600 dark:text-zinc-400">Name</label>
                    <input
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      value={form.name}
                      onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs text-zinc-600 dark:text-zinc-400">Recipients (comma-separated)</label>
                    <input
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      placeholder={defaultRecipient}
                      value={form.recipients}
                      onChange={(e) => setForm((s) => ({ ...s, recipients: e.target.value }))}
                    />
                    <div className="text-xs text-zinc-500">
                      If empty or invalid, falls back to <span className="font-mono">{defaultRecipient}</span>.
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Frequency</label>
                      <select
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        value={form.frequency}
                        onChange={(e) => setForm((s) => ({ ...s, frequency: e.target.value === "weekly" ? "weekly" : "daily" }))}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Send hour (0–23)</label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        value={form.sendHour}
                        onChange={(e) => setForm((s) => ({ ...s, sendHour: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Timezone</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        value={form.timezone}
                        onChange={(e) => setForm((s) => ({ ...s, timezone: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs text-zinc-600 dark:text-zinc-400">Agents</label>
                    <div className="flex flex-wrap gap-2">
                      {AGENTS.map((a) => (
                        <label key={a} className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={form.agents.includes(a)}
                            onChange={(e) =>
                              setForm((s) => ({
                                ...s,
                                agents: e.target.checked ? [...s.agents, a] : s.agents.filter((x) => x !== a),
                              }))
                            }
                          />
                          {a}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs text-zinc-600 dark:text-zinc-400">Severities</label>
                    <div className="flex flex-wrap gap-2">
                      {SEVERITIES.map((s) => (
                        <label key={s} className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={form.severities.includes(s)}
                            onChange={(e) =>
                              setForm((st) => ({
                                ...st,
                                severities: e.target.checked ? [...st.severities, s] : st.severities.filter((x) => x !== s),
                              }))
                            }
                          />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Min CVSS</label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        value={form.minCvss}
                        onChange={(e) => setForm((s) => ({ ...s, minCvss: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Requirements</label>
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={form.requireCve}
                            onChange={(e) => setForm((s) => ({ ...s, requireCve: e.target.checked }))}
                          />
                          CVE only
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={form.requireKev}
                            onChange={(e) => setForm((s) => ({ ...s, requireKev: e.target.checked }))}
                          />
                          KEV / actively exploited
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Tags (any) — comma-separated</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        placeholder="windows, exchange, fortinet"
                        value={form.tagsAny}
                        onChange={(e) => setForm((s) => ({ ...s, tagsAny: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs text-zinc-600 dark:text-zinc-400">Tags (all) — comma-separated</label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                        placeholder="kev"
                        value={form.tagsAll}
                        onChange={(e) => setForm((s) => ({ ...s, tagsAll: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {editingId ? (
                  <>
                    <button
                      type="button"
                      disabled={busy === `upd:${editingId}`}
                      onClick={save}
                      className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy === "create"}
                    onClick={create}
                    className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                  >
                    Create connection
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy === "preview"}
                  onClick={generatePreview}
                  className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
                >
                  Preview digest
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Existing connections" description="Configure multiple digests for different audiences." />
            <CardContent>
              {rows.length ? (
                <div className="overflow-auto">
                  <table className="min-w-[960px] w-full text-sm">
                    <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                      <tr>
                        <th className="py-2 text-left font-medium pr-4">Enabled</th>
                        <th className="py-2 text-left font-medium pr-4">Name</th>
                        <th className="py-2 text-left font-medium pr-4">Recipients</th>
                        <th className="py-2 text-left font-medium pr-4">Schedule</th>
                        <th className="py-2 text-left font-medium pr-4">Last sent</th>
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
                          <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">
                            {r.recipients.length ? (
                              <span className="font-mono">{r.recipients.join(", ")}</span>
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            {String(r.frequency)} @ {r.sendHour}:00 {r.timezone}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                            {fmtWhen(r.lastSentAt)}
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
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No email digests configured yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Preview" description="Generated digest message (plain text)." />
          <CardContent>
            {preview ? (
              <div className="space-y-3">
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  <div>
                    <span className="text-zinc-500">To:</span>{" "}
                    <span className="font-mono">{preview.recipients.join(", ") || "—"}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Subject:</span>{" "}
                    <span className="font-mono">{preview.subject}</span>
                  </div>
                  <div className="text-zinc-500">
                    Window: {preview.windowLabel || "—"} · Findings:{" "}
                    <span className="tabular-nums">{preview.count}</span>
                  </div>
                </div>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto whitespace-pre-wrap">
                  {preview.body}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Generate a preview from the Connections tab.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

