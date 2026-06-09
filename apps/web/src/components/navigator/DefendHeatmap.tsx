"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type TechniqueTile = {
  id: string;
  name: string;
  bucket: number; // 0-5
  mentions90d: number;
  itw90d: number;
  actorCount: number;
  d3fendCount: number;
  d3fendCategories: string[];
  subtechniques?: TechniqueTile[];
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
    return "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 hover:bg-zinc-50/80 dark:hover:bg-black/30";

  // Use a single “globe-like” red heat ramp with higher contrast than the default pastels.
  if (b === 1)
    return "border-red-300/80 dark:border-red-900/70 bg-red-50/90 dark:bg-red-950/25 hover:bg-red-100/90 dark:hover:bg-red-950/35";
  if (b === 2)
    return "border-red-400/80 dark:border-red-800/70 bg-red-100/90 dark:bg-red-950/35 hover:bg-red-200/90 dark:hover:bg-red-950/45";
  if (b === 3)
    return "border-red-500/80 dark:border-red-700/70 bg-red-200/90 dark:bg-red-950/45 hover:bg-red-300/90 dark:hover:bg-red-950/55";
  if (b === 4)
    return "border-red-600/85 dark:border-red-600/75 bg-red-300/90 dark:bg-red-900/45 hover:bg-red-400/90 dark:hover:bg-red-900/55";
  return "border-red-700/90 dark:border-red-500/80 bg-red-400/90 dark:bg-red-800/45 hover:bg-red-500/90 dark:hover:bg-red-800/55";
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function d3CategoryClass(category: string) {
  const key = String(category ?? "")
    .trim()
    .toLowerCase();
  if (key.includes("detect")) return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  if (key.includes("harden")) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (key.includes("isolate")) return "bg-amber-500/10 text-amber-800 dark:text-amber-300";
  if (key.includes("deceive")) return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
  if (key.includes("evict")) return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (key.includes("restore")) return "bg-teal-500/10 text-teal-700 dark:text-teal-300";
  return "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
}

function parentTechniqueId(id: string) {
  const v = String(id ?? "").toUpperCase();
  const idx = v.indexOf(".");
  return idx >= 0 ? v.slice(0, idx) : v;
}

export function DefendHeatmap({
  projectSlug,
  days,
  columns,
  heatBy,
}: {
  projectSlug: string;
  days: number;
  columns: TacticColumn[];
  heatBy: "mentions" | "actors" | "d3fend";
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DrilldownResponse | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const matrixScrollRef = useRef<HTMLDivElement | null>(null);
  const matrixContentRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncLock = useRef(false);
  const [matrixScrollWidth, setMatrixScrollWidth] = useState(0);

  const selectedGroupMeta = useMemo(() => {
    if (!selectedId) return null;
    const parentId = parentTechniqueId(selectedId);
    for (const c of columns) {
      const found = c.items.find((x) => x.id === parentId);
      if (found) return found;
    }
    return null;
  }, [columns, selectedId]);

  const selectedMeta = useMemo(() => {
    if (!selectedId) return null;
    if (!selectedGroupMeta) return null;
    if (selectedGroupMeta.id === selectedId) return selectedGroupMeta;
    return selectedGroupMeta.subtechniques?.find((x) => x.id === selectedId) ?? null;
  }, [selectedGroupMeta, selectedId]);

  const isGroupView = Boolean(selectedGroupMeta?.subtechniques?.length) && selectedGroupMeta?.id === selectedId;

  const topSubtechnique = useMemo(() => {
    const subs = selectedGroupMeta?.subtechniques ?? [];
    if (!subs.length) return null;
    return subs.reduce((best, cur) => {
      if (!best) return cur;
      if ((cur.bucket ?? 0) !== (best.bucket ?? 0)) return (cur.bucket ?? 0) > (best.bucket ?? 0) ? cur : best;
      if ((cur.mentions90d ?? 0) !== (best.mentions90d ?? 0))
        return (cur.mentions90d ?? 0) > (best.mentions90d ?? 0) ? cur : best;
      return cur.id.localeCompare(best.id) < 0 ? cur : best;
    }, null as TechniqueTile | null);
  }, [selectedGroupMeta]);

  const hasAnyD3fend = useMemo(
    () => columns.some((c) => c.items.some((it) => (it.d3fendCount ?? 0) > 0)),
    [columns]
  );

  const hasAnyMentions = useMemo(() => {
    for (const c of columns) {
      for (const it of c.items) {
        if ((it.mentions90d ?? 0) > 0) return true;
        for (const s of it.subtechniques ?? []) if ((s.mentions90d ?? 0) > 0) return true;
      }
    }
    return false;
  }, [columns]);

  const hasAnyHeat = useMemo(() => {
    for (const c of columns) {
      for (const it of c.items) {
        if ((it.bucket ?? 0) > 0) return true;
        for (const s of it.subtechniques ?? []) if ((s.bucket ?? 0) > 0) return true;
      }
    }
    return false;
  }, [columns]);

  const heatLabel =
    heatBy === "mentions"
      ? `mentions in the last ${nf(days)} days`
      : heatBy === "actors"
        ? "ATT&CK actor prevalence"
        : "D3FEND coverage";

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

  useEffect(() => {
    const content = matrixContentRef.current;
    if (!content) return;

    const update = () => setMatrixScrollWidth(content.scrollWidth);
    update();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(content);
    return () => ro.disconnect();
  }, [columns, expanded]);

  function syncScroll(from: "top" | "matrix") {
    if (scrollSyncLock.current) return;
    scrollSyncLock.current = true;

    const top = topScrollRef.current;
    const matrix = matrixScrollRef.current;
    if (top && matrix) {
      if (from === "top") matrix.scrollLeft = top.scrollLeft;
      else top.scrollLeft = matrix.scrollLeft;
    }

    requestAnimationFrame(() => {
      scrollSyncLock.current = false;
    });
  }

  return (
    <div className={expanded ? "" : "mt-8"}>
      {expanded ? (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setExpanded(false)}
          role="button"
          tabIndex={0}
          aria-label="Close matrix"
        />
      ) : null}

      <div
        className={
          expanded
            ? "fixed inset-4 md:inset-8 z-50 flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl"
            : ""
        }
      >
        <div className={expanded ? "p-5 border-b border-zinc-200/70 dark:border-zinc-800/80" : ""}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                MITRE matrix map
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Techniques are colored by {heatLabel}. Click a technique to see mitigations and mapped D3FEND
                countermeasures.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Heat</span>
                <div className="flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((b) => (
                    <span key={b} className={`h-3 w-3 rounded-[6px] border ${bucketClass(b)}`} />
                  ))}
                </div>
                <span className="tabular-nums">0 → 5</span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 bg-white/40 dark:bg-black/20 px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-zinc-700 dark:text-zinc-200">
              What do “heat” and buckets (0–5) mean?
            </summary>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              <p>
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">Heat</span> is the tile’s color
                intensity. Higher bucket = “hotter” color.
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">Bucket 0</span> means the selected
                metric is <span className="font-mono">0</span> for that technique.
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">Buckets 1–5</span> are{" "}
                <span className="font-semibold">relative</span>: we log-scale the metric{" "}
                (<span className="font-mono">log(1 + value)</span>) and split non-zero techniques into{" "}
                <span className="font-semibold">quintiles</span> (20% bands). Bucket{" "}
                <span className="font-mono">5</span> is “hotter” than the rest of the current dataset, not an absolute
                threshold.
              </p>
              <p className="mt-2">
                Active metric: <span className="font-mono">{heatBy}</span> ({heatLabel}).
              </p>
            </div>
          </details>

          {!hasAnyMentions && heatBy !== "mentions" ? (
            <div className="mt-4 rounded-xl border border-sky-200/80 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
              No MITRE-tagged findings detected in the last <span className="font-mono">{days}</span> days yet, so all
              tiles would be bucket <span className="font-mono">0</span>. Coloring falls back to{" "}
              <span className="font-mono">{heatLabel}</span> until findings include technique IDs.
            </div>
          ) : !hasAnyHeat ? (
            <div className="mt-4 rounded-xl border border-sky-200/80 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
              No data to score the matrix yet (all tiles are bucket <span className="font-mono">0</span>).
            </div>
          ) : null}

          {!hasAnyD3fend ? (
            <div className="mt-4 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
              No D3FEND mappings detected yet. Re-run <span className="font-mono">pnpm run:ttp -- --force</span> (and
              make sure <span className="font-mono">TTP_SYNC_D3FEND</span> isn’t disabled), then refresh.
            </div>
          ) : null}
        </div>

        <div className={expanded ? "p-5 pt-4 flex-1 min-h-0" : "mt-5"}>
          <div
            className={`${expanded ? "h-full " : ""}flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 overflow-hidden`}
          >
            <div
              ref={topScrollRef}
              onScroll={() => syncScroll("top")}
              className="overflow-x-auto border-b border-zinc-200/70 dark:border-zinc-800/80"
              aria-label="Matrix horizontal scroll"
            >
              <div
                style={{ width: matrixScrollWidth ? `${matrixScrollWidth}px` : undefined }}
                className="h-4"
              />
            </div>
            <div
              ref={matrixScrollRef}
              onScroll={() => syncScroll("matrix")}
              className={`overflow-x-auto overflow-y-auto ${expanded ? "flex-1 min-h-0" : "max-h-[70vh]"}`}
            >
              <div ref={matrixContentRef} className="flex gap-4 min-w-max pb-4 px-4 pt-4">
              {columns.map((c) => (
                <div key={c.slug} className="min-w-[280px] max-w-[280px]">
                  <div className="sticky top-0 z-10 bg-white/80 dark:bg-zinc-950/80 backdrop-blur pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.label}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {nf(c.items.length)}
                        {c.items.some((x) => (x.d3fendCount ?? 0) > 0) ? (
                          <span className="ml-2 text-indigo-700 dark:text-indigo-300">
                            D3 {nf(c.items.filter((x) => (x.d3fendCount ?? 0) > 0).length)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 space-y-2">
                    {c.items.map((it) => {
                      const subCount = it.subtechniques?.length ?? 0;
                      const cats = it.d3fendCategories ?? [];
                      const heatCount =
                        heatBy === "mentions" ? it.mentions90d : heatBy === "actors" ? it.actorCount : it.d3fendCount;
                      const isHot = (it.bucket ?? 0) >= 5;
                      return (
                        <button
                          key={`${c.slug}-${it.id}`}
                          type="button"
                          onClick={() => setSelectedId(it.id)}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${bucketClass(it.bucket)} ${
                            parentTechniqueId(selectedId) === it.id
                              ? "ring-2 ring-sky-400/60 dark:ring-sky-700/60"
                              : ""
                          }`}
                          title={`${it.id} — ${it.name}\nMentions: ${nf(it.mentions90d)}\nIn the wild: ${nf(it.itw90d)}\nActors: ${nf(it.actorCount)}\nD3FEND mappings: ${nf(it.d3fendCount)}${
                            subCount ? `\nSub-techniques: ${nf(subCount)}` : ""
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              <div
                                className={`text-[11px] font-mono text-zinc-700 dark:text-zinc-300 ${isHot ? "font-semibold" : ""}`}
                              >
                                {it.id}
                              </div>
                              {subCount ? (
                                <span className="rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums">
                                  +{nf(subCount)}
                                </span>
                              ) : null}
                            </div>
                            <div className="shrink-0 flex items-center gap-2">
                              {it.d3fendCount ? (
                                <>
                                  <span className="rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">
                                    D3 {nf(it.d3fendCount)}
                                  </span>
                                  {cats.length ? (
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${d3CategoryClass(
                                        cats[0]!
                                      )}`}
                                      title={`D3FEND: ${cats.join(", ")}`}
                                    >
                                      {cats[0]}
                                    </span>
                                  ) : null}
                                  {cats.length > 1 ? (
                                    <span
                                      className="rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums"
                                      title={`D3FEND: ${cats.join(", ")}`}
                                    >
                                      +{nf(cats.length - 1)}
                                    </span>
                                  ) : null}
                                </>
                              ) : null}
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                                {nf(heatCount)}
                                {heatBy === "mentions" && it.itw90d ? (
                                  <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div
                            className={`mt-0.5 text-xs text-zinc-900 dark:text-zinc-100 truncate ${isHot ? "font-bold" : "font-medium"}`}
                          >
                            {it.name}
                          </div>
                        </button>
                      );
                    })}
                    {!c.items.length ? (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">No techniques matched this tactic yet.</div>
                    ) : null}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Legend: <span className="font-semibold">D3</span> = D3FEND mappings, <span className="font-semibold">*</span>{" "}
            = in the wild. Use the top scrollbar to pan across tactics.
          </div>
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
                    Mentions:{" "}
                    {nf(isGroupView ? selectedGroupMeta?.mentions90d ?? 0 : data?.counts.mentions ?? selectedMeta?.mentions90d ?? 0)}{" "}
                    • ITW:{" "}
                    {nf(isGroupView ? selectedGroupMeta?.itw90d ?? 0 : data?.counts.itw ?? selectedMeta?.itw90d ?? 0)}{" "}
                    • Actors: {nf(isGroupView ? selectedGroupMeta?.actorCount ?? 0 : selectedMeta?.actorCount ?? 0)} • D3FEND:{" "}
                    {nf(isGroupView ? selectedGroupMeta?.d3fendCount ?? 0 : selectedMeta?.d3fendCount ?? 0)}
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
                {isGroupView && topSubtechnique ? (
                  <>
                    <Link
                      href={`/findings?mitreId=${encodeURIComponent(topSubtechnique.id)}&days=${encodeURIComponent(String(days))}`}
                      className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-sm font-medium hover:opacity-95"
                    >
                      Open findings (top sub-technique)
                    </Link>
                    <button
                      type="button"
                      onClick={() => setSelectedId(topSubtechnique.id)}
                      className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                    >
                      View {topSubtechnique.id}
                    </button>
                  </>
                ) : (
                  <Link
                    href={`/findings?mitreId=${encodeURIComponent(selectedId)}&days=${encodeURIComponent(String(days))}`}
                    className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-sm font-medium hover:opacity-95"
                  >
                    Open findings
                  </Link>
                )}
                {selectedGroupMeta && selectedGroupMeta.id !== selectedId ? (
                  <button
                    type="button"
                    onClick={() => setSelectedId(selectedGroupMeta.id)}
                    className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                  >
                    Parent: {selectedGroupMeta.id}
                  </button>
                ) : null}
              </div>

              {isGroupView ? (
                <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4 text-sm text-zinc-700 dark:text-zinc-300">
                  Pick a sub-technique to see mitigations and D3FEND countermeasures. The parent tile aggregates metrics
                  across its sub-techniques.
                </div>
              ) : null}

              {loading ? (
                <div className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">Loading…</div>
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

              {selectedGroupMeta?.subtechniques?.length ? (
                <div className="mt-6">
                  <div className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                    Sub-techniques
                  </div>
                  <div className="mt-2 space-y-2">
                    {selectedGroupMeta.subtechniques.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                          selectedId === s.id
                            ? "border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/25"
                            : "border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 hover:bg-white/60 dark:hover:bg-black/30"
                        }`}
                        title={`${s.id} — ${s.name}\nMentions: ${nf(s.mentions90d)}\nD3FEND mappings: ${nf(s.d3fendCount)}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{s.id}</div>
                            <div className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {s.name}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {s.d3fendCount ? (
                              <>
                                <span className="rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">
                                  D3 {nf(s.d3fendCount)}
                                </span>
                                {s.d3fendCategories?.length ? (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${d3CategoryClass(
                                      s.d3fendCategories[0]!
                                    )}`}
                                    title={`D3FEND: ${s.d3fendCategories.join(", ")}`}
                                  >
                                    {s.d3fendCategories[0]}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {nf(s.mentions90d)}
                              {s.itw90d ? <span className="ml-1 text-rose-600 dark:text-rose-400">*</span> : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
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
