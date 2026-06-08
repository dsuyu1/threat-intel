"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function normalizeLines(text: string) {
  return text
    .split(/[\r\n]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2000);
}

export function IocBulkAddForm(props: { projectSlug: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const count = useMemo(() => normalizeLines(text).length, [text]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const res = await fetch("/api/iocs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));

      const added = Array.isArray(data?.added) ? data.added.length : 0;
      const errors = Array.isArray(data?.errors) ? data.errors.length : 0;
      setSummary(`Added ${added}${errors ? ` • ${errors} invalid` : ""}`);
      setText("");
      router.refresh();
    } catch (err) {
      setError(String((err as any)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        placeholder={"1.2.3.4\nexample.com\nhttps://example.com/path\n44d88612fea8a8f36de82e1278abb02f"}
        className="w-full resize-y rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
      />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500">{count ? `${count} line${count === 1 ? "" : "s"}` : "—"}</div>
          {error ? <div className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          {!error && summary ? <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{summary}</div> : null}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !count}
          className="shrink-0 inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
        >
          {busy ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}

