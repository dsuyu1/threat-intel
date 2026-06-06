"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "../ui/Card";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  criteria: any;
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

function safeMaskUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return `${u.protocol}//${host}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return url ? "Invalid URL" : "";
  }
}

export function JiraAutomationConnections({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"connections" | "links">("connections");
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => {
    return {
      name: "CVE → Jira",
      webhookUrl: "",
      enabled: true,
      agents: ["vuln", "exploit"],
      severities: ["critical", "high"],
      minCvss: 7,
      requireCve: true,
      requireKev: false,
      tagsAny: "",
      tagsAll: "",
    };
  }, []);

  const [form, setForm] = useState(() => ({ ...defaults }));

  const resetForm = () => {
    setEditingId(null);
    setError(null);
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

  const startEdit = (r: Row) => {
    if (editingId && editingId !== r.id) {
      if (!confirm("Discard unsaved changes and edit a different connection?")) return;
    }
    const c = (r.criteria ?? {}) as any;
    setTab("connections");
    setEditingId(r.id);
    setError(null);
    setForm({
      name: r.name ?? "",
      webhookUrl: r.webhookUrl ?? "",
      enabled: !!r.enabled,
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
      const criteria = criteriaPayload();

      const res = await fetch("/api/integrations/jira-automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          webhookUrl: form.webhookUrl,
          enabled: form.enabled,
          criteria,
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
      const res = await fetch(`/api/integrations/jira-automation/${id}`, {
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
    if (!confirm("Delete this Jira automation connection?")) return;
    setBusy(`del:${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/jira-automation/${id}`, { method: "DELETE" });
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
      webhookUrl: form.webhookUrl,
      enabled: form.enabled,
      criteria: criteriaPayload(),
    });
    if (ok) resetForm();
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Jira automations</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Send new findings to a Jira Automation “Incoming webhook” rule when they match your criteria.
        </p>
      </header>

      <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-1">
        {[
          ["connections", "Connections"],
          ["links", "Automation links"],
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
                editingId
                  ? "Update the webhook URL and criteria, then save changes."
                  : "Paste a Jira Automation webhook URL and set your criteria."
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
                    <label className="text-xs text-zinc-600 dark:text-zinc-400">Jira automation webhook URL</label>
                    <input
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm"
                      placeholder="https://automation.atlassian.com/pro/hooks/…"
                      value={form.webhookUrl}
                      onChange={(e) => setForm((s) => ({ ...s, webhookUrl: e.target.value }))}
                    />
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
                        placeholder="vpn, edge"
                        value={form.tagsAll}
                        onChange={(e) => setForm((s) => ({ ...s, tagsAll: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      disabled={!!busy}
                      onClick={editingId ? save : create}
                      className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                    >
                      {editingId
                        ? busy === `upd:${editingId}`
                          ? "Saving…"
                          : "Save changes"
                        : busy === "create"
                          ? "Creating…"
                          : "Create connection"}
                    </button>

                    {editingId ? (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={resetForm}
                        className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Existing connections" description="Edit, toggle on/off, or delete connections." />
            <CardContent>
              {rows.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                      <tr>
                        <th className="py-2 text-left font-medium pr-4">Enabled</th>
                        <th className="py-2 text-left font-medium pr-4">Name</th>
                        <th className="py-2 text-left font-medium pr-4">Webhook</th>
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
                          <td className="py-3 pr-4 min-w-[360px] text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="font-mono">{safeMaskUrl(r.webhookUrl)}</span>
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
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No Jira automation connections yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Automation links" description="Helpful references and payload fields for Jira smart values." />
          <CardContent>
            <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Jira rule setup</div>
                <ul className="list-disc pl-5 space-y-1 text-zinc-600 dark:text-zinc-400">
                  <li>Create a Jira Automation rule with trigger: Incoming webhook.</li>
                  <li>Copy the generated webhook URL into the Connections tab.</li>
                  <li>Use smart values from the payload to set summary/description.</li>
                </ul>
              </div>

              <div className="space-y-1">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Example smart values</div>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">
{`Summary:
{{webhookData.finding.cveId}} — {{webhookData.finding.title}}

Description:
Severity: {{webhookData.finding.severity}}
CVSS: {{webhookData.finding.cvss.score}}
Source: {{webhookData.finding.source.url}}
App link: {{webhookData.finding.url}}

Action items:
{{#webhookData.actionItems}}- {{label}}{{#if url}} ({{url}}){{/}}{{/}}`}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
