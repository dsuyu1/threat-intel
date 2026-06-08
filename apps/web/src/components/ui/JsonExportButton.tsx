"use client";

import { useState } from "react";

export function JsonExportButton(props: {
  url: string;
  filename: string;
  projectSlug: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      const res = await fetch(props.url, {
        method: "GET",
        headers: { "x-ti-project-slug": props.projectSlug, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = props.filename || "export.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
    >
      {busy ? "Exporting..." : props.label ?? "Export JSON"}
    </button>
  );
}

