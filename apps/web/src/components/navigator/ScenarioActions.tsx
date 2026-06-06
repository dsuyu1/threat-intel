"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ActionRow = {
  id: string;
  title: string;
  status: string;
  dueDate: string | Date | null;
};

function toDateInputValue(d: string | Date | null) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export function ScenarioActions(props: { projectSlug: string; scenarioId: string; initialActions: ActionRow[] }) {
  const router = useRouter();
  const [actions, setActions] = useState<ActionRow[]>(props.initialActions ?? []);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const rank: Record<string, number> = { todo: 0, in_progress: 1, done: 2 };
    return actions
      .slice()
      .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (toDateInputValue(a.dueDate) || "9999").localeCompare(toDateInputValue(b.dueDate) || "9999"));
  }, [actions]);

  const createAction = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await fetch("/api/navigator/actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({
          scenarioId: props.scenarioId,
          title: t,
          dueDate: due ? new Date(due).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      setTitle("");
      setDue("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const patchAction = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/navigator/actions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);

      setActions((prev) =>
        prev.map((a) => (a.id === id ? ({ ...a, ...patch } as any) : a))
      );
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
    <div>
      {sorted.length ? (
        <div className="mt-3 space-y-2">
          {sorted.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-3 flex items-center gap-3"
            >
              <select
                className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-2 py-1 text-sm"
                value={a.status}
                onChange={(e) => patchAction(a.id, { status: e.target.value })}
                disabled={busy}
              >
                <option value="todo">todo</option>
                <option value="in_progress">in_progress</option>
                <option value="done">done</option>
              </select>

              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{a.title}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  due{" "}
                  <input
                    type="date"
                    className="ml-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-2 py-1 text-xs"
                    value={toDateInputValue(a.dueDate)}
                    onChange={(e) =>
                      patchAction(a.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                    disabled={busy}
                  />
                </div>
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
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No actions yet.</p>
      )}

      <div className="mt-4 flex flex-col md:flex-row gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add an action (e.g., Validate detection coverage for T1059)"
          className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
          disabled={busy}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
          disabled={busy}
        />
        <button
          type="button"
          onClick={createAction}
          disabled={busy || !title.trim()}
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          Add
        </button>
      </div>
    </div>
  );
}
