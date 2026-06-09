"use client";

import { useEffect } from "react";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";
  const digest = String(error?.digest ?? "");

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10 space-y-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Something went wrong</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        An unexpected error occurred. Try again, or return to Learn.
      </p>
      {digest ? (
        <p className="text-xs text-zinc-500">
          Error ID: <span className="tabular-nums">{digest}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
        >
          Try again
        </button>
        <a
          href="/learn"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
        >
          Back to Learn
        </a>
      </div>

      {isDev ? (
        <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-xs text-zinc-700 dark:text-zinc-200">
          {String(error?.stack ?? error?.message ?? error)}
        </pre>
      ) : null}
    </div>
  );
}
