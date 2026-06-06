"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecomputeButton(props: { projectSlug: string; lastUpdatedAt?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const updatedLabel = (() => {
    const iso = props.lastUpdatedAt;
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  })();

  const run = async () => {
    setBusy(true);
    try {
      await fetch("/api/navigator/recompute", {
        method: "POST",
        headers: { "x-ti-project-slug": props.projectSlug },
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
        type="button"
        onClick={run}
        disabled={busy}
        title={updatedLabel ? `Last updated: ${updatedLabel}` : undefined}
        className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
      >
        {busy ? "Recomputing..." : "Recompute"}
      </button>
  );
}
