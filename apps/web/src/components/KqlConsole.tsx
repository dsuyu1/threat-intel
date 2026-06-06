"use client";

import { useState } from "react";
import { CsvExportButton } from "./ui/CsvExportButton";

type QueryResponse = {
  columns: string[];
  rows: Record<string, unknown>[];
  meta?: {
    durationMs?: number;
    rowCount?: number;
    tables?: string[];
  };
  debug?: {
    sql: string;
    params: unknown[];
  };
};

const EXAMPLES: Array<{ label: string; query: string }> = [
  {
    label: "Top actors by TTPs",
    query:
      'Actors | sort by ttpCount desc | take 25 | project actorId,name,originIso2,ttpCount,mitigationCount,cveCount,sectorCount,lastSeen',
  },
  {
    label: "Actors exploiting a CVE",
    query:
      'Actors | join kind=inner (Relations | where type == "actor_exploits_cve") on $left.actorId == $right.fromId | where toId == "CVE-2024-0001" | project actorId,name,toId,support,confidence | sort by support desc | take 50',
  },
  {
    label: "CVEs per actor",
    query:
      'Relations | where type == "actor_exploits_cve" | summarize cves=dcount(toId) by fromId | sort by cves desc | take 50',
  },
  {
    label: "Evidence for sector targeting",
    query:
      'Relations | where type == "actor_targets_sector" | join kind=inner (Evidence) on $left.relationId == $right.relationId | project fromId,toId,excerpt,url,publishedAt,confidence | sort by publishedAt desc | take 50',
  },
];

function formatCell(v: unknown) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function KqlConsole() {
  const [query, setQuery] = useState(EXAMPLES[0]?.query ?? "Actors | take 10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  const columns = result?.columns ?? [];
  const rows = result?.rows ?? [];

  const csvColumns = columns.map((c) => ({ header: c, key: c }));

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        setResult(null);
        setError(String(data?.error ?? "Query failed"));
        return;
      }
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/35 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Query
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={loading}
              className="rounded-lg bg-zinc-900 text-white px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-60 transition-colors"
            >
              {loading ? "Running…" : "Run"}
            </button>
            {rows.length ? (
              <CsvExportButton
                filename="query-results.csv"
                rows={rows}
                columns={csvColumns}
                label="Export CSV"
              />
            ) : null}
          </div>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          className="mt-3 w-full min-h-[140px] font-mono text-[13px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/30 p-3 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setQuery(ex.query)}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-black/35 transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="mt-3 text-xs text-zinc-500">
          Supported stages: <span className="font-mono">where</span>,{" "}
          <span className="font-mono">project</span>,{" "}
          <span className="font-mono">sort by</span>,{" "}
          <span className="font-mono">take</span>,{" "}
          <span className="font-mono">join</span>,{" "}
          <span className="font-mono">summarize</span>.
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <div>
              {typeof result?.meta?.rowCount === "number" ? (
                <span className="tabular-nums">
                  {result.meta.rowCount} row{result.meta.rowCount === 1 ? "" : "s"}
                </span>
              ) : null}
              {typeof result?.meta?.durationMs === "number" ? (
                <span className="ml-2 tabular-nums">{result.meta.durationMs}ms</span>
              ) : null}
            </div>
            <div className="tabular-nums">
              {columns.length} col{columns.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/35 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white/90 dark:bg-black/70">
                <tr className="text-left text-xs text-zinc-600 dark:text-zinc-400">
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900/80">
                {rows.map((r, idx) => (
                  <tr key={idx} className="text-zinc-900 dark:text-zinc-100">
                    {columns.map((c) => {
                      const v = (r as any)[c];
                      const s = formatCell(v);
                      return (
                        <td
                          key={c}
                          className="px-3 py-2 max-w-[420px] truncate"
                          title={s}
                        >
                          {s}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, columns.length)}
                      className="px-3 py-6 text-sm text-zinc-500"
                    >
                      No rows.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
