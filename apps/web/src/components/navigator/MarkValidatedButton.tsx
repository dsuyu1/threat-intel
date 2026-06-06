"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkValidatedButton(props: { projectSlug: string; scenarioId: string; validationStatus?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await fetch(`/api/navigator/scenarios/${props.scenarioId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ validationStatus: "validated" }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void run();
      }}
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white/90 dark:hover:bg-black/30 disabled:opacity-60"
    >
      {busy ? "Saving..." : "Mark validated"}
    </button>
  );
}
