"use client";

import { useMemo, useState } from "react";
import type { GlobalNewsItem } from "../lib/global-news";

function safeHost(input: string) {
  try {
    const u = new URL(String(input));
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 text-zinc-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobalNewsTray({
  items,
  schemaReady = true,
}: {
  items: GlobalNewsItem[];
  schemaReady?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const caption = useMemo(() => {
    if (!schemaReady) return "Run pnpm db:migrate to enable news.";
    if (!items.length) return "No articles yet.";
    return `${items.length} recent`;
  }, [items.length, schemaReady]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none">
      <div className="pointer-events-auto mx-auto w-full max-w-[1440px] px-6 pb-6">
        <div
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-zinc-950/70 backdrop-blur shadow-2xl shadow-black/10 dark:shadow-black/60 overflow-hidden"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <div className="min-w-0 flex items-center gap-3">
              <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Global news</div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">{caption}</div>
              </div>
            </div>
            <Chevron open={open} />
          </button>

          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              open ? "max-h-[60vh] opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="border-t border-zinc-200/70 dark:border-zinc-800/80 px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  Latest articles, advisories, and posts pulled from your configured sources.
                </div>
                <a
                  href="/data/documents"
                  className="shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  View all
                </a>
              </div>

              {!schemaReady ? (
                <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Database migration required</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Documents tables aren’t available yet. Run:
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 p-3 text-xs font-mono">
pnpm db:migrate
                  </pre>
                </div>
              ) : !items.length ? (
                <div className="mt-4 text-sm text-zinc-500">No articles ingested yet.</div>
              ) : (
                <ul className="mt-4 max-h-[50vh] overflow-y-auto pr-1 space-y-2">
                  {items.map((it) => {
                    const host = safeHost(it.url);
                    const when = it.publishedAt ?? it.fetchedAt;
                    return (
                      <li key={it.id}>
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
                        >
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2">
                            {it.title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                            {host ? <span className="truncate max-w-[42ch]">{host}</span> : null}
                            {host && when ? <span aria-hidden="true">•</span> : null}
                            {when ? <span className="tabular-nums">{fmtWhen(when)}</span> : null}
                          </div>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
