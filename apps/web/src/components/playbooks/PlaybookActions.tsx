"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaybookStatus } from "../../lib/playbooks/types";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

export function PlaybookActions(props: {
  projectSlug: string;
  playbookId: string;
  status: PlaybookStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setStatus = async (status: PlaybookStatus) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/playbooks/${props.playbookId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ti-project-slug": props.projectSlug,
        },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));
      router.refresh();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.status !== "approved" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setStatus("approved")}
          className="h-9 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          Approve
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setStatus("draft")}
          className="h-9 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors disabled:opacity-60"
        >
          Back to draft
        </button>
      )}

      {props.status !== "archived" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setStatus("archived")}
          className="h-9 inline-flex items-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 disabled:opacity-60"
        >
          Archive
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setStatus("draft")}
          className="h-9 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors disabled:opacity-60"
        >
          Restore
        </button>
      )}

      {error ? <div className="ml-2 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}
    </div>
  );
}

