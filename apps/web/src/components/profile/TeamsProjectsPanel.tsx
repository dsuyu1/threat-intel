"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Project = { id: string; teamId: string; slug: string; name: string };

type ApiResponse =
  | { ok: true; team: { id: string; name: string }; project: Project; projects: Project[] }
  | { error: string };

const EMPTY_PROJECTS: Project[] = [];

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function getShareUrl(slug: string) {
  const path = `/p/${slug}`;
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

export function TeamsProjectsPanel() {
  const [data, setData] = useState<{ team: { id: string; name: string }; project: Project; projects: Project[] } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newProjectName, setNewProjectName] = useState("");

  const currentSlug = data?.project.slug ?? "";
  const projects = data?.projects ?? EMPTY_PROJECTS;

  const sortedProjects = useMemo(() => {
    if (!projects.length) return [];
    return [...projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects");
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        const msg = json && "error" in json ? json.error : `Failed to load projects (${res.status})`;
        throw new Error(msg);
      }
      setData({ team: json.team, project: json.project, projects: json.projects });
    } catch (e) {
      setError(safeErrorMessage(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearNoticeSoon = () => {
    window.setTimeout(() => setNotice(""), 1800);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = String(newProjectName ?? "").trim();
    if (!name) return;
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));
      setNewProjectName("");
      await load();
      setNotice("Project created");
      clearNoticeSoon();
    } catch (e2) {
      setError(safeErrorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const onSetDefault = async (projectSlug: string) => {
    const slug = String(projectSlug ?? "").trim();
    if (!slug) return;
    if (slug === currentSlug) return;
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/projects/default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectSlug: slug }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));
      await load();
      setNotice("Default project updated");
      clearNoticeSoon();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (projectSlug: string) => {
    const url = getShareUrl(projectSlug);
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied");
      clearNoticeSoon();
    } catch {
      setNotice(url);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 shadow-2xl shadow-black/10 dark:shadow-black/40">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Teams & Projects</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Projects scope shared dashboards (Navigator, Risk, Agents, Connections). Invite teammates via your auth org
            (Clerk Organizations) so they can open the same project URLs.
          </p>
          {data ? (
            <div className="mt-2 text-xs text-zinc-500">
              Current team: <span className="font-medium text-zinc-700 dark:text-zinc-300">{data.team.name}</span>
              {" · "}
              Default project:{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{data.project.name}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {notice ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-1">
              {notice}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy || loading}
            className="h-9 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Create project</div>
          <form onSubmit={onCreate} className="mt-3 flex items-center gap-2">
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="e.g. Acme Prod"
              className="h-10 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
            <button
              type="submit"
              disabled={busy || loading || !newProjectName.trim()}
              className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95 disabled:opacity-60"
            >
              Create
            </button>
          </form>
          <div className="mt-2 text-[11px] text-zinc-500">
            Creating a project also sets it as your default.
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Share a project</div>
          <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
            Send teammates the project URL (example):{" "}
            <span className="font-mono text-xs">{currentSlug ? `/p/${currentSlug}` : "/p/default"}</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500">
            Anyone in the same team/org can open it and see the same project-scoped data.
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Projects</div>
          {loading ? <div className="text-xs text-zinc-500">Loading…</div> : null}
        </div>

        <div className="mt-2 space-y-2">
          {sortedProjects.length ? (
            sortedProjects.map((p) => {
              const isDefault = p.slug === currentSlug;
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</div>
                      {isDefault ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                          default
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-500">/p/{p.slug}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/p/${p.slug}`}
                      className="h-8 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => void onCopy(p.slug)}
                      className="h-8 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
                    >
                      Copy link
                    </button>
                    {!isDefault ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onSetDefault(p.slug)}
                        className="h-8 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2.5 text-sm font-medium hover:opacity-95 disabled:opacity-60"
                      >
                        Make default
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-3 text-sm text-zinc-500">
              {loading ? "Loading projects…" : "No projects found."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
