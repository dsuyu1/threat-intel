"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActorIcon } from "./ui/ActorIcon";

type Neighbor = {
  actorId: string;
  name: string;
  distance: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function similarityFromDistance(distance: number) {
  // pgvector cosine distance is typically: 1 - cosine_similarity
  const d = Number.isFinite(distance) ? distance : 1;
  return clamp(1 - d, 0, 1);
}

function Icon({
  name,
  className,
}: {
  name: "fullscreen" | "exitFullscreen";
  className?: string;
}) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
  if (name === "exitFullscreen") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M8 3H3v5" />
        <path {...common} d="M3 3l7 7" />
        <path {...common} d="M16 3h5v5" />
        <path {...common} d="M21 3l-7 7" />
        <path {...common} d="M8 21H3v-5" />
        <path {...common} d="M3 21l7-7" />
        <path {...common} d="M16 21h5v-5" />
        <path {...common} d="M21 21l-7-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path {...common} d="M8 3H3v5" />
      <path {...common} d="M16 3h5v5" />
      <path {...common} d="M8 21H3v-5" />
      <path {...common} d="M16 21h5v-5" />
    </svg>
  );
}

export function SimilaritySpokes({
  center,
  neighbors,
}: {
  center: { actorId: string; name: string };
  neighbors: Neighbor[];
}) {
  const items = neighbors.slice(0, 10);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [view, setView] = useState<{ scale: number; tx: number; ty: number }>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const movedRef = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      setIsFullscreen(!!fsEl && fsEl === fullscreenRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      setViewport({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const baseRadius = 180 + items.length * 6;
    const best = Math.min(...items.map((n) => (Number.isFinite(n.distance) ? n.distance : 1)));
    const dMin = best > 0 ? best : 0.001;

    // Ratio-based radial distance:
    //  - best neighbor ~1.0x base radius
    //  - less similar neighbors push outward proportionally
    const maxRatio = 8;

    const points = items.map((n, i) => {
      const a = (-Math.PI / 2) + (i / Math.max(1, items.length)) * Math.PI * 2;
      const ratio = clamp((Number.isFinite(n.distance) ? n.distance : 1) / dMin, 1, maxRatio);
      const radius = baseRadius * Math.pow(ratio, 0.9);
      return {
        ...n,
        sim: similarityFromDistance(n.distance),
        a,
        radius,
      };
    });

    const maxR = Math.max(baseRadius, ...points.map((p) => p.radius));
    const marginX = 260;
    const marginY = 220;
    const W = Math.round((maxR + marginX) * 2);
    const H = Math.round((maxR + marginY) * 2);
    const cx = W / 2;
    const cy = H / 2;

    const centerBubbleR = 38; // ActorIcon 72px + ring
    const neighborBubbleR = 30; // ActorIcon 56px + ring
    const centerRingR = centerBubbleR + 22; // stroke circle around center

    const nodes = points.map((p) => {
      const x = cx + p.radius * Math.cos(p.a);
      const y = cy + p.radius * Math.sin(p.a);
      return { ...p, x, y };
    });

    const edges = nodes.map((n) => {
      const dx = n.x - cx;
      const dy = n.y - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      const x1 = cx + ux * centerBubbleR;
      const y1 = cy + uy * centerBubbleR;
      const x2 = n.x - ux * neighborBubbleR;
      const y2 = n.y - uy * neighborBubbleR;
      return { actorId: n.actorId, x1, y1, x2, y2, sim: n.sim };
    });

    // Content bounds (in "world" px) for initial fit.
    // Includes icon bubbles + truncated labels so the first load is "zoomed in" but still contains all nodes.
    const labelGap = 8;
    const centerLabelHalfW = 110; // max-w-[220px]
    const neighborLabelHalfW = 100; // max-w-[200px]
    const centerLabelH = 26;
    const neighborLabelH = 22;

    let minX = cx - Math.max(centerRingR, centerLabelHalfW);
    let maxX = cx + Math.max(centerRingR, centerLabelHalfW);
    let minY = cy - centerRingR;
    let maxY = cy + centerRingR + labelGap + centerLabelH;

    for (const n of nodes) {
      const extX = Math.max(neighborBubbleR, neighborLabelHalfW);
      minX = Math.min(minX, n.x - extX);
      maxX = Math.max(maxX, n.x + extX);
      minY = Math.min(minY, n.y - neighborBubbleR);
      maxY = Math.max(maxY, n.y + neighborBubbleR + labelGap + neighborLabelH);
    }

    const bounds = { minX, minY, maxX, maxY };

    return { W, H, cx, cy, nodes, edges, centerBubbleR, bounds };
  }, [items]);

  const fitToViewport = useCallback(() => {
    const w = viewport.w;
    const h = viewport.h;
    if (!w || !h) return;

    const b = layout.bounds;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);

    // Small, consistent padding so the initial view is tight while still avoiding clipping.
    const padPx = clamp(Math.round(Math.min(w, h) * 0.045), 14, 28);
    const usableW = Math.max(1, w - padPx * 2);
    const usableH = Math.max(1, h - padPx * 2);

    const s = clamp(Math.min(usableW / bw, usableH / bh), 0.15, 6);
    const tx = (w - bw * s) / 2 - b.minX * s;
    const ty = (h - bh * s) / 2 - b.minY * s;
    setView({ scale: s, tx, ty });
  }, [viewport.w, viewport.h, layout.bounds]);

  useEffect(() => {
    if (movedRef.current) return;
    fitToViewport();
  }, [fitToViewport]);

  // Wheel zoom (keeps the cursor point stable).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const cur = viewRef.current;
      const zoom = Math.exp(-e.deltaY * 0.0012);
      const nextScale = clamp(cur.scale * zoom, 0.15, 6);

      const wx = (px - cur.tx) / cur.scale;
      const wy = (py - cur.ty) / cur.scale;

      const tx = px - wx * nextScale;
      const ty = py - wy * nextScale;

      movedRef.current = true;
      setView({ scale: nextScale, tx, ty });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer panning.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const drag = { active: false, pointerId: 0, startX: 0, startY: 0, startTx: 0, startTy: 0 };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target?.closest("a,button")) return;
      drag.active = true;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startTx = viewRef.current.tx;
      drag.startTy = viewRef.current.ty;
      movedRef.current = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };

    const onMove = (e: PointerEvent) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setView((v) => ({ ...v, tx: drag.startTx + dx, ty: drag.startTy + dy }));
    };

    const end = (e: PointerEvent) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      drag.active = false;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      el.style.cursor = "grab";
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
  }, []);

  if (items.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">No neighbors computed yet.</p>;
  }

  return (
    <section aria-label="Similarities Map" className="w-full">
      <div
        ref={fullscreenRef}
        className={[
          "w-full",
          isFullscreen ? "h-full flex flex-col bg-white dark:bg-[#0b1115] p-6 md:p-10" : "",
        ].join(" ")}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Similarities Map
            </h2>
            <p className="mt-1 text-sm text-zinc-500">Drag to pan. Scroll to zoom.</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                movedRef.current = false;
                fitToViewport();
              }}
              className="h-9 px-3 inline-flex items-center justify-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-black/30 text-xs text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
              aria-label="Reset view"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-black/30 text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <Icon name={isFullscreen ? "exitFullscreen" : "fullscreen"} className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={[
            "mt-4 relative w-full overflow-hidden select-none touch-none",
            isFullscreen ? "flex-1 min-h-[320px]" : "h-[360px]",
          ].join(" ")}
          style={{ cursor: "grab" }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: layout.W,
              height: layout.H,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              width={layout.W}
              height={layout.H}
              className="absolute left-0 top-0"
              role="img"
              aria-label={`Similarities map for ${center.name}`}
            >
              {layout.edges.map((e) => {
                const label = `${Math.round(e.sim * 100)}%`;
                const strokeW = 1 + e.sim * 2;
                const midX = (e.x1 + e.x2) / 2;
                const midY = (e.y1 + e.y2) / 2;
                return (
                  <g key={e.actorId}>
                    <line
                      x1={e.x1}
                      y1={e.y1}
                      x2={e.x2}
                      y2={e.y2}
                      stroke="currentColor"
                      strokeWidth={strokeW}
                      strokeOpacity={0.35}
                      className="text-zinc-500 dark:text-zinc-600"
                    />
                    <text
                      x={midX}
                      y={midY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="currentColor"
                      className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}


            </svg>

            {/* Center node */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: layout.cx, top: layout.cy }}
            >
              <div className="relative">
                <div className="rounded-full ring-2 ring-zinc-200 dark:ring-zinc-800">
                  <ActorIcon seed={center.actorId} size={72} title={center.name} className="block" />
                </div>
                <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 max-w-[220px] text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {center.name}
                </div>
              </div>
            </div>

            {/* Neighbor nodes */}
            {layout.nodes.map((n) => (
              <div
                key={n.actorId}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: n.x, top: n.y }}
              >
                <Link
                  href={`/actors/${n.actorId}`}
                  className="group relative block"
                  title={`${n.name} — ${Math.round(n.sim * 100)}% similarity`}
                >
                  <div className="rounded-full ring-2 ring-zinc-200 dark:ring-zinc-800 group-hover:ring-blue-500/50 transition-colors">
                    <ActorIcon seed={n.actorId} size={56} title={n.name} className="block" />
                  </div>
                  <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 max-w-[200px] text-center text-xs font-medium text-zinc-700 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                    {n.name}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
