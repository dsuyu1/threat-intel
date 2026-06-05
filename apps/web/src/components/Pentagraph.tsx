"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

type Facet = {
  label: string;
  value: string;
  sub?: string | null;
  weight?: number;
};

type Branch = {
  items: Array<{
    label: string;
    weight: number;
  }>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function mixHex(a: string, b: string, t: number) {
  const ta = clamp(t, 0, 1);
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(A.r * (1 - ta) + B.r * ta);
  const g = Math.round(A.g * (1 - ta) + B.g * ta);
  const b2 = Math.round(A.b * (1 - ta) + B.b * ta);
  return `rgb(${r} ${g} ${b2})`;
}

type Pt = { x: number; y: number };

function catmullRomCommands(points: Pt[]) {
  if (points.length === 0) return { move: "", curves: "" };
  if (points.length === 1) {
    const p = points[0];
    return { move: `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`, curves: "" };
  }

  const move = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  const segs: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    segs.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }
  return { move, curves: segs.join(" ") };
}

function catmullRomPath(points: Pt[]) {
  const { move, curves } = catmullRomCommands(points);
  return [move, curves].filter(Boolean).join(" ").trim();
}

function hash01(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function formatWeight(w: number) {
  if (!Number.isFinite(w)) return "0";
  if (w >= 1000) return `${(w / 1000).toFixed(1)}k`;
  if (w >= 100) return `${Math.round(w)}`;
  if (w >= 10) return w.toFixed(1);
  if (w >= 1) return w.toFixed(2);
  return w.toFixed(3);
}

const SPECTRUM_DARK = [
  { t: 0, c: "#ff2d55" },    // magenta-red
  { t: 0.18, c: "#ff3b30" }, // red
  { t: 0.36, c: "#ff7a18" }, // orange
  { t: 0.52, c: "#ffd60a" }, // yellow
  { t: 0.74, c: "#39d7ff" }, // cyan
  { t: 1, c: "#2f6bff" },    // blue
];

const SPECTRUM_LIGHT = [
  { t: 0, c: "#ff2d55" },
  { t: 0.18, c: "#ff3b30" },
  { t: 0.36, c: "#ff7a18" },
  { t: 0.52, c: "#ffcc00" },
  { t: 0.74, c: "#00bcd4" },
  { t: 1, c: "#2563eb" },
];

function Icon({
  name,
  className,
}: {
  name: "zoomIn" | "zoomOut" | "reset" | "fullscreen" | "exitFullscreen";
  className?: string;
}) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
  if (name === "zoomIn") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
        <path {...common} d="M21 21l-4.3-4.3" />
        <path {...common} d="M11 8v6" />
        <path {...common} d="M8 11h6" />
      </svg>
    );
  }
  if (name === "zoomOut") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
        <path {...common} d="M21 21l-4.3-4.3" />
        <path {...common} d="M8 11h6" />
      </svg>
    );
  }
  if (name === "reset") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M3 12a9 9 0 1 0 3-6.7" />
        <path {...common} d="M3 4v5h5" />
      </svg>
    );
  }
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

export function Pentagraph({ facets, branches }: { facets: Facet[]; branches: Branch[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const clipPathId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      setIsFullscreen(!!fsEl && fsEl === fullscreenRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDarkMode(root.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const plot = useMemo(() => {
    const width = Math.max(320, size.width || 1200);
    const height = Math.max(320, size.height || 640);

    const padding = { left: 88, right: 40, top: 34, bottom: 54 };
    const w = Math.max(1, width - padding.left - padding.right);
    const h = Math.max(1, height - padding.top - padding.bottom);

    const facetCount = Math.min(5, Math.max(0, facets.length), Math.max(0, branches.length));
    const groups = Array.from({ length: facetCount }).map((_, i) => {
      const facet = facets[i];
      const items = branches[i]?.items ?? [];
      return { index: i, facet, items };
    });

    const weightsRaw = groups.flatMap((g) => g.items.map((it) => Math.max(0, it.weight)));
    const logWeights = weightsRaw.map((x) => Math.log1p(x));
    const maxLog = Math.max(0, ...logWeights);

    const yBase = h;
    const stemMin = 14;
    const stemMax = Math.max(80, Math.round(h * 0.78));

    const toNorm = (weight: number) => {
      const lw = Math.log1p(Math.max(0, weight));
      return maxLog > 0 ? lw / maxLog : 0;
    };

    const nodes: Array<{ x: number; norm: number }> = [];

    groups.forEach((g) => {
      const groupX = (g.index + 0.5) * (w / Math.max(1, facetCount));
      const n = g.items.length;
      const segmentW = w / Math.max(1, facetCount);
      const step = n > 1 ? Math.min(44, segmentW / (n + 0.75)) : 0;

      g.items.forEach((it, idx) => {
        const norm = toNorm(it.weight);
        const centerOffset = n > 1 ? (idx - (n - 1) / 2) * step : 0;
        const jitter = (hash01(`${g.index}:${it.label}`) - 0.5) * Math.min(10, step * 0.35 + 4);
        const x = clamp(groupX + centerOffset + jitter, 6, w - 6);
        nodes.push({ x, norm });
      });
    });

    const surfaceBaseY = yBase - 6;

    // Smooth "web-graphs" ridge derived from node weights (gaussian pulses).
    const samples = Math.max(240, Math.round(w / 2));
    const sigma = clamp(w / 18, 14, 34);
    const sigma2 = 2 * sigma * sigma;

    const pulses = nodes.map((n) => ({
      x: n.x,
      amp: Math.pow(n.norm, 1.35) * (stemMax * 0.85),
    }));

    const depthsRaw: number[] = [];
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * w;
      let d = 0;
      for (const p of pulses) {
        const dx = x - p.x;
        d += p.amp * Math.exp(-(dx * dx) / sigma2);
      }
      depthsRaw.push(clamp(d, 0, stemMax * 0.95));
    }

    // Fade to baseline at the plot edges to avoid hard vertical cut-offs when closing the fill path.
    const smoothstep01 = (t: number) => t * t * (3 - 2 * t);
    const taperW = clamp(w * 0.08, 32, 96);
    for (let i = 0; i < depthsRaw.length; i++) {
      const x = (i / (samples - 1)) * w;
      const left = smoothstep01(clamp(x / taperW, 0, 1));
      const right = smoothstep01(clamp((w - x) / taperW, 0, 1));
      depthsRaw[i] = depthsRaw[i] * left * right;
    }

    // Extra smoothing to avoid faceting/corners when rendered as an SVG path.
    let depths = depthsRaw;
    for (let pass = 0; pass < 2; pass++) {
      const next = depths.slice();
      for (let i = 0; i < depths.length; i++) {
        const a = depths[i - 1] ?? depths[i];
        const b = depths[i];
        const c = depths[i + 1] ?? depths[i];
        next[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
      depths = next;
    }

    const ridgePts = depths.map((d, i) => {
      const x = (i / (samples - 1)) * w;
      return { x, y: surfaceBaseY - d };
    });

    const ridgePath = catmullRomPath(ridgePts);

    const layerScales = [1, 0.82, 0.67, 0.55, 0.45, 0.36, 0.28, 0.2, 0];
    const layers = layerScales.slice(0, -1).map((sTop, idx) => {
      const sBot = layerScales[idx + 1] ?? 0;
      const topPts = depths.map((d, i) => {
        const x = (i / (samples - 1)) * w;
        return { x, y: surfaceBaseY - d * sTop };
      });
      const botPts = depths.map((d, i) => {
        const x = (i / (samples - 1)) * w;
        return { x, y: surfaceBaseY - d * sBot };
      });

      const botRev = botPts.slice().reverse();
      const topCmd = catmullRomCommands(topPts);
      const botCmd = catmullRomCommands(botRev);

      const connect = botRev[0] ? `L ${botRev[0].x.toFixed(2)} ${botRev[0].y.toFixed(2)}` : "";
      const dPath = [topCmd.move, topCmd.curves, connect, botCmd.curves, "Z"].filter(Boolean).join(" ");

      const opacity = clamp(0.34 - idx * 0.03, 0.08, 0.34);
      return { idx, d: dPath, opacity };
    });

    const vlines: number[] = [];
    const vStep = clamp(Math.round(w / 22), 34, 72);
    for (let x = 0; x <= w; x += vStep) vlines.push(x);

    const tickCount = 5;
    const ticks = Array.from({ length: tickCount }).map((_, i) => {
      const t = i / (tickCount - 1);
      return { t, y: yBase - t * (stemMin + stemMax) };
    });

    return {
      width,
      height,
      padding,
      plotW: w,
      plotH: h,
      facetCount,
      groups,
      surfaceBaseY,
      ridgePath,
      layers,
      vlines,
      ticks,
      yBase,
    };
  }, [branches, facets, size.height, size.width]);

  const toggleFullscreen = useCallback(async () => {
    const el = fullscreenRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // ignore
    }
  }, []);

  const plotTransform = `translate(${plot.padding.left} ${plot.padding.top})`;
  const themeKey = isDarkMode ? "d" : "l";
  const spectrum = isDarkMode ? SPECTRUM_DARK : SPECTRUM_LIGHT;

  const coolTint = isDarkMode ? "#071a2b" : "#ffffff";
  const layerGradientId = (idx: number) => `pg-layer-${clipPathId}-${themeKey}-${idx}`;

  return (
    <section aria-label="Overview" className="w-full">
      <div
        ref={fullscreenRef}
        className={[
          "w-full",
          isFullscreen ? "h-full flex flex-col bg-white dark:bg-[#0b1115] p-6 md:p-10" : "",
        ].join(" ")}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Overview
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Terrain shows top relationships; totals are listed below. “Relative weight (log)” means we take log(1 + score) and scale it relative to the actor’s maximum, so very large scores don’t dominate the chart.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
            isFullscreen ? "flex-1 min-h-[320px]" : "h-[55vh] min-h-[440px] max-h-[720px]",
          ].join(" ")}
          style={{ cursor: "zoom-in" }}
        >
          <svg
            viewBox={`0 0 ${plot.width} ${plot.height}`}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label="Overview graph"
          >
            <defs>
              <clipPath id={clipPathId}>
                <rect
                  x={plot.padding.left - 10}
                  y={plot.padding.top - 10}
                  width={plot.plotW + 20}
                  height={plot.plotH + 20}
                />
              </clipPath>

              {plot.layers.map((layer, idx) => {
                const t = plot.layers.length > 1 ? idx / (plot.layers.length - 1) : 0;
                const mixT = (isDarkMode ? 0.68 : 0.32) * t;
                return (
                  <linearGradient
                    key={`lg:${layer.idx}`}
                    id={layerGradientId(layer.idx)}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    {spectrum.map((s) => (
                      <stop
                        key={`${layer.idx}:${s.t}`}
                        offset={`${Math.round(s.t * 100)}%`}
                        stopColor={mixHex(s.c, coolTint, mixT)}
                      />
                    ))}
                  </linearGradient>
                );
              })}
            </defs>

          {/* Axes */}
          <g stroke={isDarkMode ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"} strokeWidth={1} opacity={0.85}>
            <line
              x1={plot.padding.left}
              y1={plot.padding.top}
              x2={plot.padding.left}
              y2={plot.padding.top + plot.plotH}
            />
            <line
              x1={plot.padding.left}
              y1={plot.padding.top + plot.plotH}
              x2={plot.padding.left + plot.plotW}
              y2={plot.padding.top + plot.plotH}
            />
          </g>

          {/* Y ticks */}
          <g stroke={isDarkMode ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"} strokeWidth={1}>
            {plot.ticks.map((t) => (
              <g key={t.t}>
                <line
                  x1={plot.padding.left}
                  y1={plot.padding.top + t.y}
                  x2={plot.padding.left + plot.plotW}
                  y2={plot.padding.top + t.y}
                  opacity={t.t === 0 ? 0.35 : 0.18}
                />
                <text
                  x={plot.padding.left - 10}
                  y={plot.padding.top + t.y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill={isDarkMode ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)"}
                >
                  {t.t === 0 ? "0" : t.t === 1 ? "max" : t.t.toFixed(2)}
                </text>
              </g>
            ))}
            <text
              x={14}
              y={plot.padding.top + plot.plotH / 2}
              transform={`rotate(-90 14 ${plot.padding.top + plot.plotH / 2})`}
              fontSize={11}
              fill={isDarkMode ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)"}
            >
              Relative weight (log)
            </text>
          </g>

          {/* X labels */}
          <g fill={isDarkMode ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)"}>
            {plot.groups.map((g) => {
              const x = plot.padding.left + (g.index + 0.5) * (plot.plotW / Math.max(1, plot.facetCount));
              const y = plot.padding.top + plot.plotH + 28;
              return (
                <g key={g.index}>
                  <text x={x} y={y} textAnchor="middle" fontSize={12}>
                    {g.facet?.label ?? `Facet ${g.index + 1}`}
                  </text>
                  <text
                    x={x}
                    y={y + 14}
                    textAnchor="middle"
                    fontSize={11}
                    fill={isDarkMode ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}
                  >
                    {g.facet?.value ?? "\u2014"}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Plot content */}
          <g clipPath={`url(#${clipPathId})`}>
            <g transform={plotTransform}>
              {/* Vertical hairlines */}
              {plot.vlines.map((x) => (
                <line
                  key={`vl:${x}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={plot.plotH}
                  stroke={isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}
                  strokeWidth={1}
                  opacity={0.6}
                />
              ))}

              {/* Stacked terrain layers */}
              {plot.layers.map((layer) => (
                <path
                  key={`layer:${layer.idx}`}
                  d={layer.d}
                  fill={`url(#${layerGradientId(layer.idx)})`}
                  opacity={layer.opacity}
                  transform={`translate(${layer.idx * 0.7} ${layer.idx * 1.6})`}
                  style={{ mixBlendMode: isDarkMode ? "screen" : "multiply" }}
                />
              ))}

              {/* Ridge outline */}
              <path
                d={plot.ridgePath}
                fill="none"
                stroke={isDarkMode ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)"}
                strokeWidth={1}
                opacity={0.65}
              />
            </g>
          </g>
          </svg>
        </div>

        {!isFullscreen ? (
          <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-5">
            {facets.slice(0, 5).map((f) => (
              <div key={f.label} className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-zinc-500">{f.label}</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums truncate">
                  {f.value}
                </div>
                {f.sub ? <div className="mt-1 text-xs text-zinc-500">{f.sub}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
