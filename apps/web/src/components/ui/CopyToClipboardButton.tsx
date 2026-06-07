"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Copy failed");
}

export function CopyToClipboardButton(props: {
  text: string;
  label?: string;
  className?: string;
  onCopiedMessage?: (msg: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCopy = async () => {
    const s = String(props.text ?? "");
    if (!s) return;

    setError(null);
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
      props.onCopiedMessage?.("Copied");
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      const msg = safeErrorMessage(e);
      setError(msg);
      props.onCopiedMessage?.(msg);
      window.setTimeout(() => setError(null), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={
        props.className ??
        "h-9 inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
      }
      aria-label={props.label ? `Copy: ${props.label}` : "Copy to clipboard"}
      title={props.label ? `Copy ${props.label}` : "Copy"}
    >
      <Copy size={16} aria-hidden="true" />
      <span>{copied ? "Copied" : error ? "Failed" : "Copy"}</span>
    </button>
  );
}

