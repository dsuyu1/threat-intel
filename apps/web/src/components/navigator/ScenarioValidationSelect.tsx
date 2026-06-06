"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const OPTIONS = ["unvalidated", "in_progress", "validated", "not_applicable"] as const;

export function ScenarioValidationSelect(props: { projectSlug: string; scenarioId: string; initialStatus: string }) {
  const router = useRouter();
  const [value, setValue] = useState(props.initialStatus ?? "unvalidated");
  const [busy, setBusy] = useState(false);

  const onChange = async (next: string) => {
    setValue(next);
    setBusy(true);
    try {
      await fetch(`/api/navigator/scenarios/${props.scenarioId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ validationStatus: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
