"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { PlaybookViewer } from "./PlaybookViewer";
import type { PlaybookContentFormat, PlaybookContentV1 } from "../../lib/playbooks/types";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function isPlaybookContentV1(value: unknown): value is PlaybookContentV1 {
  const v = value as any;
  return v && typeof v === "object" && v.version === 1 && typeof v.title === "string" && Array.isArray(v.phases);
}

function parseByFormat(text: string, format: PlaybookContentFormat) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: false as const, error: "Playbook content is empty." };
  try {
    const parsed = format === "yaml" ? loadYaml(raw) : JSON.parse(raw);
    if (!isPlaybookContentV1(parsed)) {
      return { ok: false as const, error: "Content must be a PlaybookContentV1 object (version: 1)." };
    }
    return { ok: true as const, value: parsed };
  } catch (e) {
    return { ok: false as const, error: safeErrorMessage(e) };
  }
}

function formatByFormat(value: unknown, format: PlaybookContentFormat) {
  if (format === "yaml") {
    return dumpYaml(value, { noRefs: true, lineWidth: 120 });
  }
  return JSON.stringify(value, null, 2);
}

export function PlaybookDraftEditor(props: {
  projectSlug: string;
  playbookId: string;
  initialFormat: PlaybookContentFormat;
  initialText: string;
}) {
  const router = useRouter();
  const [format, setFormat] = useState<PlaybookContentFormat>(props.initialFormat);
  const [text, setText] = useState(props.initialText);
  const [busy, setBusy] = useState<null | "save" | "approve" | "archive">(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const parsed = useMemo(() => parseByFormat(text, format), [text, format]);

  const onChangeFormat = (next: PlaybookContentFormat) => {
    if (next === format) return;
    const canConvert = parseByFormat(text, format);
    if (canConvert.ok) setText(formatByFormat(canConvert.value, next));
    setFormat(next);
  };

  const patch = async (payload: Record<string, unknown>, kind: NonNullable<typeof busy>) => {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/playbooks/${props.playbookId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-ti-project-slug": props.projectSlug },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    void patch(
      { status: "draft", contentFormat: format, contentText: text },
      "save"
    );

  const onApprove = () =>
    void patch(
      { status: "approved", contentFormat: format, contentText: text },
      "approve"
    );

  const onArchive = () => void patch({ status: "archived" }, "archive");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <label className="block">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Format</div>
            <select
              value={format}
              onChange={(e) => onChangeFormat(e.target.value as PlaybookContentFormat)}
              className="mt-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
          </label>
          <div className="text-xs text-zinc-500 pb-2">
            Drafts are editable. On approval, we store the playbook in the selected format.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={onSave}
            className="h-9 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40 disabled:opacity-60"
          >
            {busy === "save" ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            disabled={!!busy || !parsed.ok}
            onClick={onApprove}
            className="h-9 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-sm font-medium hover:opacity-95 disabled:opacity-60"
            title={!parsed.ok ? parsed.error : undefined}
          >
            {busy === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={onArchive}
            className="h-9 inline-flex items-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 disabled:opacity-60"
          >
            {busy === "archive" ? "Archiving..." : "Archive"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-h-[360px] resize-y rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-zinc-500">
            {!parsed.ok ? <span className="text-rose-600 dark:text-rose-400">{parsed.error}</span> : "Looks valid."}
          </div>
          <div className="text-zinc-500 tabular-nums">
            {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : null}
          </div>
        </div>
        {error ? <div className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
      </div>

      {parsed.ok ? <PlaybookViewer content={parsed.value} /> : null}
    </div>
  );
}

