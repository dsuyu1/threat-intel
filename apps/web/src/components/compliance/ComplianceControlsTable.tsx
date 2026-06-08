"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ComplianceControlRow, ComplianceFramework } from "../../lib/compliance";
import { statusClasses } from "../../lib/compliance";

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function ComplianceControlsTable(props: {
  projectSlug: string;
  framework: ComplianceFramework;
  controls: ComplianceControlRow[];
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const rows = useMemo(() => {
    if (!query) return props.controls;
    return props.controls.filter((c) => {
      const id = c.controlId.toLowerCase();
      const title = (c.title ?? "").toLowerCase();
      return id.includes(query) || title.includes(query);
    });
  }, [props.controls, query]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Controls</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Coverage is derived from Navigator signals (actions + detections) for validated scenarios.
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search controls..."
          className="w-64 max-w-[55vw] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/30 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
        />
      </div>

      <div className="mt-4 divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
        <div className="hidden md:grid grid-cols-12 gap-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <div className="col-span-3">Control</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Coverage</div>
          <div className="col-span-2 text-right">Max residual</div>
          <div className="col-span-3">Evidence</div>
        </div>

        {rows.length ? (
          rows.map((c) => (
            <div key={c.controlId} className="py-3 grid grid-cols-1 md:grid-cols-12 gap-2">
              <div className="md:col-span-3 min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{c.controlId}</div>
                {c.title ? <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 truncate">{c.title}</div> : null}
              </div>

              <div className="md:col-span-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(c.status)}`}>
                  {c.status}
                </span>
              </div>

              <div className="md:col-span-2 md:text-right">
                <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {nf(c.bestCoveragePct)}%
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">{nf(c.evidenceScenarioCount)} scenarios</div>
              </div>

              <div className="md:col-span-2 md:text-right">
                <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {nf(c.maxResidual)}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">0–100</div>
              </div>

              <div className="md:col-span-3 min-w-0">
                {c.topScenarios.length ? (
                  <div className="space-y-1">
                    {c.topScenarios.map((s) => (
                      <Link
                        key={s.id}
                        href={`/p/${props.projectSlug}/risk/${s.id}`}
                        className="block text-xs text-indigo-600 dark:text-indigo-400 hover:underline truncate"
                      >
                        {s.title || s.id} · residual {nf(s.residual)} · cov {nf(s.coveragePct)}%
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500">No mapped evidence yet.</div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="py-4 text-sm text-zinc-600 dark:text-zinc-400">No matching controls.</div>
        )}
      </div>
    </div>
  );
}

