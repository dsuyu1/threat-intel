"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SourceEnabledToggle(props: { sourceId: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(props.sourceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !props.enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const label = props.enabled ? "Disable" : "Enable";

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`rounded-md border px-2 py-1 text-xs disabled:opacity-60 ${
          props.enabled
            ? "border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-200 hover:bg-rose-50/60 dark:hover:bg-rose-950/20"
            : "border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20"
        }`}
      >
        {busy ? "Saving…" : label}
      </button>
      {error ? (
        <span className="text-[11px] text-rose-700 dark:text-rose-200" title={error}>
          error
        </span>
      ) : null}
    </div>
  );
}

