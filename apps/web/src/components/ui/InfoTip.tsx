"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-8.75-3a.75.75 0 0 1 .75-.75h.01a.75.75 0 1 1 0 1.5H10A.75.75 0 0 1 9.25 7Zm.75 2.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function InfoTip({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => setOpen(false), 70);
  }, [clearHideTimer]);

  const show = useCallback(() => {
    clearHideTimer();
    setOpen(true);
  }, [clearHideTimer]);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const width = 280;
    const margin = 10;

    let left = rect.left;
    if (left + width + margin > window.innerWidth) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;

    const estimatedHeight = 120;
    const belowTop = rect.bottom + 8;
    const above = belowTop + estimatedHeight > window.innerHeight;
    const top = above ? rect.top - 8 : rect.bottom + 8;

    setPos({ left, top, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();

    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePos]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  const tooltip =
    open && pos ? (
      <div
        className="fixed z-[9999] w-[280px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 p-2 text-[11px] normal-case text-zinc-700 dark:text-zinc-200 shadow-2xl shadow-black/10 dark:shadow-black/70 backdrop-blur"
        style={{
          left: pos.left,
          top: pos.top,
          transform: pos.above ? "translateY(-100%)" : undefined,
        }}
        role="tooltip"
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
      >
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <div className="mt-1 text-zinc-700 dark:text-zinc-300 leading-snug">{body}</div>
      </div>
    ) : null;

  return (
    <span className={["inline-flex", className].filter(Boolean).join(" ")}>
      <span
        ref={anchorRef}
        className="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        aria-label={`Info: ${title}`}
        tabIndex={0}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </span>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </span>
  );
}

