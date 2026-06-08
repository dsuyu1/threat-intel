"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fixText } from "../../lib/text";

type ActionRow = {
  id: string;
  title: string;
  status: string;
  slaTier: string;
  dueDate: string | Date | null;
  scenarioId: string;
  scenarioTitle: string;
  scenarioScore: number;
};

function toDateInputValue(d: string | Date | null) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function isOverdue(action: { status: string; dueDate: string | Date | null }) {
  if (action.status === "done") return false;
  if (!action.dueDate) return false;
  const dt = action.dueDate instanceof Date ? action.dueDate : new Date(action.dueDate);
  if (!Number.isFinite(dt.getTime())) return false;
  return dt.getTime() < Date.now();
}

export function NavigatorActionsTable(props: { projectSlug: string; initialActions: ActionRow[] }) {
  const router = useRouter();
  const [actions, setActions] = useState<ActionRow[]>(props.initialActions ?? []);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState("");

  const overdueCount = useMemo(() => actions.filter(isOverdue).length, [actions]);

  const downloadExport = async (format: "csv" | "json") => {
    setExportError("");
    setDownloading(format);
    try {
      const url =
        format === "csv"
          ? "/api/navigator/actions?format=csv"
          : "/api/navigator/actions?format=json&download=1";
      const res = await fetch(url, { headers: { "x-ti-project-slug": props.projectSlug } });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      }

      const blob = await res.blob();
      const ext = format === "csv" ? "csv" : "json";
      const filename = `navigator-actions-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      setExportError(String(e?.message ?? e));
    } finally {
      setDownloading(null);
    }
  };

  const sorted = useMemo(() => {
    const rank: Record<string, number> = { todo: 0, in_progress: 1, done: 2 };
    return actions
      .slice()
      .sort(
        (a, b) =>
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          (b.scenarioScore ?? 0) - (a.scenarioScore ?? 0) ||
          (toDateInputValue(a.dueDate) || "9999").localeCompare(toDateInputValue(b.dueDate) || "9999")
      );
  }, [actions]);

  const patchAction = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/navigator/actions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);

      setActions((prev) => prev.map((a) => (a.id === id ? ({ ...a, ...patch } as any) : a)));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const deleteAction = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/navigator/actions/${id}`, {
        method: "DELETE",
        headers: { "x-ti-project-slug": props.projectSlug },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      setActions((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {actions.length} actions{overdueCount ? <span className="text-rose-600 dark:text-rose-400"> · {overdueCount} overdue</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void downloadExport("csv")}
            disabled={busy || downloading !== null}
            className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
          >
            {downloading === "csv" ? "Exporting..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => void downloadExport("json")}
            disabled={busy || downloading !== null}
            className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
          >
            {downloading === "json" ? "Exporting..." : "Export JSON"}
          </button>
        </div>
      </div>
      {exportError ? <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{exportError}</div> : null}

      <div className="mt-3 space-y-2">
      {sorted.map((a) => (
        <div
          key={a.id}
          className={`rounded-xl border p-4 ${
            isOverdue(a)
              ? "border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20"
              : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <a
                href={`/p/${props.projectSlug}/navigator/scenarios/${a.scenarioId}`}
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:underline"
              >
                {fixText(a.scenarioTitle)}
              </a>
              <div className="mt-1 text-xs text-zinc-500 tabular-nums">scenario score {a.scenarioScore}</div>
            </div>
            <button
              type="button"
              onClick={() => deleteAction(a.id)}
              className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              disabled={busy}
            >
              delete
            </button>
          </div>

          <div className="mt-3 flex flex-col md:flex-row gap-2">
            <select
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              value={a.status}
              onChange={(e) => patchAction(a.id, { status: e.target.value })}
              disabled={busy}
            >
              <option value="todo">todo</option>
              <option value="in_progress">in_progress</option>
              <option value="done">done</option>
            </select>

            <select
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              value={a.slaTier}
              onChange={(e) => patchAction(a.id, { slaTier: e.target.value })}
              disabled={busy}
            >
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>

            <input
              type="text"
              value={a.title}
              onChange={(e) => setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, title: e.target.value } : x)))}
              onBlur={() => patchAction(a.id, { title: a.title })}
              className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              disabled={busy}
            />

            <input
              type="date"
              value={toDateInputValue(a.dueDate)}
              onChange={(e) => patchAction(a.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              disabled={busy}
            />
          </div>
        </div>
      ))}

      {!sorted.length ? <p className="text-sm text-zinc-500">No actions yet.</p> : null}
      </div>
    </div>
  );
}
