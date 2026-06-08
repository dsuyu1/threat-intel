"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type TechniqueTile = {
  id: string;
  name: string;
  bucket: number; // 0-5
  mentions90d: number;
  itw90d: number;
  actorCount: number;
};

type TacticColumn = {
  slug: string;
  label: string;
  items: TechniqueTile[];
};

type DrilldownResponse = {
  technique: {
    id: string;
    name: string;
    description: string | null;
    tactics: string[];
    tacticLabels: string[];
  } | null;
  counts: { mentions: number; itw: number; days: number };
  topActors: Array<{ id: string; name: string }>;
  mitigations: Array<{ id: string; name: string }>;
  d3fendTechniques: Array<{ id: string; name: string; url: string | null; category: string | null }>;
  viaMitigations: Array<{ mitigationId: string; mitigationName: string; d3fend: Array<{ id: string; name: string }> }>;
  links: { findings: string };
};

function bucketClass(bucket: number) {
  const b = Math.max(0, Math.min(5, Math.floor(bucket)));
  if (b === 0)
    return "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 hover:bg-white/70 dark:hover:bg-black/30";
  if (b === 1)
    return "border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/30";
  if (b === 2)
    return "border-sky-200/80 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 hover:bg-sky-50/80 dark:hover:bg-sky-950/30";
  if (b === 3)
    return "border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50/80 dark:hover:bg-amber-950/30";
  if (b === 4)
    return "border-orange-200/80 dark:border-orange-900/60 bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50/80 dark:hover:bg-orange-950/30";
  return "border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-50/80 dark:hover:bg-rose-950/30";
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

export function DefendHeatmap({
  projectSlug,
  days,
  columns,
}: {
  projectSlug: string;
  days: number;
  columns: TacticColumn[];
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DrilldownResponse | null>(null);

  const selectedMeta = useMemo(() => {
    if (!selectedId) return null;
    for (const c of columns) {
      const found = c.items.find((x) => x.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [columns, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);

    const url = new URL("/api/navigator/defend/technique", window.location.origin);
    url.searchParams.set("techniqueId", selectedId);
    url.searchParams.set("days", String(days));

    (async () => {
      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: { "x-ti-project-slug": projectSlug },
        });
        const json = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        if (!res.ok) throw new Error(String(json?.error ?? `Failed to load drilldown (${res.status})`));
        setData(json as DrilldownResponse);
      } catch (err) {
        if (cancelled) return;
        setError(safeErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [days, projectSlug, selectedId]);

  return (
    <div className="mt-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Defend heatmap
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Techniques are colored by mentions in the last <span className="tabular-nums">{nf(days)}</span> days.
            Click a technique to see mitigations and D3FEND countermeasures.
          </p>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Buckets: <span className="tabular-nums">0</span> (none) â†’ <span className="tabular-nums">5</span> (most)
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-2">
          {columns.map((c) => (
            <div key={c.slug} className="min-w-[250px] max-w-[250px]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.label}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">{nf(c.items.length)}</div>
              </div>
              <div className="mt-3 space-y-2">
                {c.items.map((it) => (
                  <button
                    key={`${c.slug}-${it.id}`}
                    type="button"
                    onClick={() => setSelectedId(it.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${bucketClass(it.bucket)} ${
                      selectedId === it.id ? "ring-2 ring-sky-400/60 dark:ring-sky-700/60" : ""
                    }`}
                    title={`${it.id} â€” ${it.name}\nMentions: ${nf(it.mentions90d)}\nIn the wild: ${nf(it.itw90d)}\nActors: ${nf(it.actorCount)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300">{it.id}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {nf(it.mentions90d)}
                        {it.itw90d ? <span className="ml-1 text-rose-600 dark:text-rose-400">*</span> : null}
                      </div>
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {it.name}
                    </div>
                  </button>
                ))}
                {!c.items.length ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">No techniques.</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedId ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setSelectedId("")}
            role="button"
            tabIndex={0}
            aria-label="Close technique details"
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-auto">
            <div className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">{selectedId}</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {data?.technique?.name ?? selectedMeta?.name ?? selectedId}
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Mentions: {nf(data?.counts.mentions ?? selectedMeta?.mentions90d ?? 0)} â€¢ ITW:{" "}
                    {nf(data?.counts.itw ?? selectedMeta?.itw90d ?? 0)} â€¢ Actors: {nf(selectedMeta?.actorCount ?? 0)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId("")}
                  className="shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/findings?mitreId=${encodeURIComponent(selectedId)}&days=${encodeURIComponent(String(days))}`}
                  className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-sm font-medium hover:opacity-95"
                >
                  Open findings
                </Link>
              </div>

              {loading ? (
                <div className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">Loadingâ€¦</div>
              ) : error ? (
                <div className="mt-5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 p-4 text-sm text-rose-800 dark:text-rose-200">
                  {error}
                </div>
              ) : null}

              {data?.technique?.description ? (
                <div className="mt-5">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                    Technique
                  </div>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                    {data.technique.description}
                  </p>
                </div>
              ) : null}

              {data?.mitigations?.length ? (
                <div className="mt-6">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                    ATT&CK mitigations
                  </div>
                  <ul className="mt-2 space-y-1">
                    {data.mitigations.slice(0, 12).map((m) => (
                      <li key={m.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{m.id}</span>{" "}
                        <span className="ml-2">{m.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {data?.d3fendTechniques?.length ? (
                <div className="mt-6">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                    D3FEND countermeasures
                  </div>
                  <ul className="mt-2 space-y-1">
                    {data.d3fendTechniques.slice(0, 16).map((d) => (
                      <li key={d.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                        {d.url ? (
                          <a className="underline hover:opacity-90" href={d.url} target="_blank" rel="noreferrer">
                            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{d.id}</span>{" "}
                            <span className="ml-2">{d.name}</span>
                          </a>
                        ) : (
                          <>
                            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{d.id}</span>{" "}
                            <span className="ml-2">{d.name}</span>
                          </>
                        )}
                        {d.category ? (
                          <span className="ml-2 text-[11px] text-zinc-500 dark:text-zinc-400">({d.category})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {data.viaMitigations?.length ? (
                    <details className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 p-3">
                      <summary className="cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                        Show mapping details (via mitigations)
                      </summary>
                      <div className="mt-3 space-y-3">
                        {data.viaMitigations.map((m) => (
                          <div key={m.mitigationId} className="text-xs text-zinc-700 dark:text-zinc-300">
                            <div className="font-medium">
                              <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                                {m.mitigationId}
                              </span>{" "}
                              <span className="ml-2">{m.mitigationName}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {m.d3fend.map((d) => (
                                <span
                                  key={`${m.mitigationId}-${d.id}`}
                                  className="rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300"
                                >
                                  {d.id}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {data?.topActors?.length ? (
                <div className="mt-6">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                    Top actors
                  </div>
                  <ul className="mt-2 space-y-1">
                    {data.topActors.slice(0, 12).map((a) => (
                      <li key={a.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{a.id}</span>{" "}
                        <span className="ml-2">{a.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

