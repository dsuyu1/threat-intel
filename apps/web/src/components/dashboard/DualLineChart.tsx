"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type LineDatum = { label: string; value: number };

function linePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtTick(value: number) {
  const v = Math.max(0, Math.round(Number(value ?? 0)));
  try {
    if (v >= 1000) {
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
    }
    return new Intl.NumberFormat("en-US").format(v);
  } catch {
    return String(v);
  }
}

export function DualLineChart({
  primary,
  secondary,
  height = 240,
  showRangeLabels = true,
  xLabel,
  yLabel,
  showEndpointLabelsInChart = false,
  showYAxisTickLabels = false,
}: {
  primary: LineDatum[];
  secondary?: LineDatum[];
  height?: number;
  showRangeLabels?: boolean;
  xLabel?: string;
  yLabel?: string;
  showEndpointLabelsInChart?: boolean;
  showYAxisTickLabels?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const fillId = `dualLineFill-${uid}`;
  const clipId = `dualLineClip-${uid}`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [hover, setHover] = useState<null | { idx: number; xPx: number; yPx: number }>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const a = primary.map((d) => Math.max(0, Number(d.value ?? 0)));
    const b = (secondary ?? []).map((d) => Math.max(0, Number(d.value ?? 0)));
    const n = Math.max(1, primary.length, secondary?.length ?? 0);

    const max = Math.max(1, ...a, ...b);
    const h = 220;
    const fallbackW = 640;
    const ratio =
      containerWidth && height > 0
        ? Math.max(1.8, containerWidth / height)
        : fallbackW / h;
    const w = h * ratio;

    const needsLeft = Boolean(yLabel) || showYAxisTickLabels;
    const needsBottom = Boolean(xLabel) || showEndpointLabelsInChart;

    const padL = needsLeft ? 56 : 16;
    const padR = 16;
    const padT = 18;
    const padB = needsBottom ? 34 : 18;
    const innerW = Math.max(1, w - padL - padR);
    const innerH = Math.max(1, h - padT - padB);

    const toPoints = (vals: number[]) => {
      const out: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) {
        const v = vals[i] ?? 0;
        const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
        const y = padT + (1 - v / max) * innerH;
        out.push({ x, y });
      }
      return out;
    };

    const p1 = toPoints(a);
    const p2 = secondary ? toPoints(b) : [];

    const d1 = linePath(p1);
    const d2 = secondary ? linePath(p2) : "";

    const area = p1.length
      ? [
          `M ${p1[0]!.x.toFixed(2)} ${(padT + innerH).toFixed(2)}`,
          ...p1.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
          `L ${p1[p1.length - 1]!.x.toFixed(2)} ${(padT + innerH).toFixed(2)}`,
          "Z",
        ].join(" ")
      : "";

    return { a, b, n, max, w, h, padL, padR, padT, padB, innerW, innerH, p1, p2, d1, d2, area };
  }, [containerWidth, height, primary, secondary, showEndpointLabelsInChart, showYAxisTickLabels, xLabel, yLabel]);

  const activeIdx = hover?.idx ?? null;
  const activePrimaryValue = activeIdx != null ? Number(primary[activeIdx]?.value ?? 0) : null;
  const activeSecondaryValue =
    activeIdx != null && secondary?.length ? Number(secondary[activeIdx]?.value ?? 0) : null;

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((ev.clientX - rect.left) / rect.width) * geom.w;
    const t = (x - geom.padL) / Math.max(1, geom.innerW);
    const idx = geom.n === 1 ? 0 : clamp(Math.round(t * (geom.n - 1)), 0, geom.n - 1);

    const point = geom.p1[idx] ?? null;
    if (!point) {
      setHover(null);
      return;
    }

    const xPx = (point.x / geom.w) * rect.width;
    const yPx = (point.y / geom.h) * rect.height;
    setHover({ idx, xPx, yPx });
  };

  const onLeave = () => setHover(null);

  const tooltip = (() => {
    if (!hover) return null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clamp(hover.xPx, 10, rect.width - 10);
    const y = clamp(hover.yPx, 10, rect.height - 10);
    return { x, y };
  })();

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${geom.w} ${geom.h}`}
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label="Trend chart"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(129 140 248)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="rgb(129 140 248)" stopOpacity="0.03" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect
              x={geom.padL}
              y={geom.padT}
              width={geom.innerW}
              height={geom.innerH}
              rx="8"
            />
          </clipPath>
        </defs>

        <rect x="0" y="0" width={geom.w} height={geom.h} rx="14" fill="transparent" />

        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={geom.padL}
            x2={geom.w - geom.padR}
            y1={geom.padT + geom.innerH * t}
            y2={geom.padT + geom.innerH * t}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="1"
            className="dark:stroke-white/10"
          />
        ))}

        <g clipPath={`url(#${clipId})`}>
          {geom.area ? <path d={geom.area} fill={`url(#${fillId})`} /> : null}
          {geom.d2 ? (
            <path d={geom.d2} fill="none" stroke="rgba(52,211,153,0.85)" strokeWidth="2" />
          ) : null}
          {geom.d1 ? <path d={geom.d1} fill="none" stroke="rgb(129 140 248)" strokeWidth="2.5" /> : null}

          {activeIdx != null && geom.p1[activeIdx] ? (
            <line
              x1={geom.p1[activeIdx]!.x}
              x2={geom.p1[activeIdx]!.x}
              y1={geom.padT}
              y2={geom.padT + geom.innerH}
              stroke="rgba(129,140,248,0.25)"
              strokeWidth="1"
            />
          ) : null}
        </g>

        <line
          x1={geom.padL}
          x2={geom.w - geom.padR}
          y1={geom.padT + geom.innerH}
          y2={geom.padT + geom.innerH}
          stroke="rgba(0,0,0,0.12)"
          strokeWidth="1"
          className="dark:stroke-white/15"
        />
        <line
          x1={geom.padL}
          x2={geom.padL}
          y1={geom.padT}
          y2={geom.padT + geom.innerH}
          stroke="rgba(0,0,0,0.12)"
          strokeWidth="1"
          className="dark:stroke-white/15"
        />

        {geom.p1.length ? (
          <circle
            cx={geom.p1[geom.p1.length - 1]!.x}
            cy={geom.p1[geom.p1.length - 1]!.y}
            r="3.5"
            fill="rgb(129 140 248)"
          />
        ) : null}

        {activeIdx != null && geom.p1[activeIdx] ? (
          <>
            <circle cx={geom.p1[activeIdx]!.x} cy={geom.p1[activeIdx]!.y} r="4" fill="rgb(129 140 248)" />
            {secondary && geom.p2[activeIdx] ? (
              <circle cx={geom.p2[activeIdx]!.x} cy={geom.p2[activeIdx]!.y} r="3.5" fill="rgba(52,211,153,0.9)" />
            ) : null}
          </>
        ) : null}

        {yLabel ? (
          <text
            x="14"
            y={geom.padT + geom.innerH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(-90 14 ${geom.padT + geom.innerH / 2})`}
            fill="currentColor"
            className="text-zinc-500 dark:text-zinc-400"
            fontSize="10"
          >
            {yLabel}
          </text>
        ) : null}

        {showYAxisTickLabels ? (
          <>
            {[0, 0.5, 1].map((t) => {
              const value = Math.round(geom.max * (1 - t));
              const y = geom.padT + geom.innerH * t;
              const baseline = t === 0 ? "hanging" : t === 1 ? "ideographic" : "middle";
              return (
                <text
                  key={t}
                  x={geom.padL - 10}
                  y={y}
                  textAnchor="end"
                  dominantBaseline={baseline as any}
                  fill="currentColor"
                  className="text-zinc-500 dark:text-zinc-400"
                  fontSize="9"
                >
                  {fmtTick(value)}
                </text>
              );
            })}
          </>
        ) : null}

        {showEndpointLabelsInChart ? (
          <>
            <text
              x={geom.padL}
              y={geom.h - 16}
              textAnchor="start"
              dominantBaseline="ideographic"
              fill="currentColor"
              className="text-zinc-500 dark:text-zinc-400"
              fontSize="9"
            >
              {primary[0]?.label ?? ""}
            </text>
            <text
              x={geom.w - geom.padR}
              y={geom.h - 16}
              textAnchor="end"
              dominantBaseline="ideographic"
              fill="currentColor"
              className="text-zinc-500 dark:text-zinc-400"
              fontSize="9"
            >
              {primary[primary.length - 1]?.label ?? ""}
            </text>
          </>
        ) : null}

        {xLabel ? (
          <text
            x={geom.padL + geom.innerW / 2}
            y={geom.h - 4}
            textAnchor="middle"
            dominantBaseline="ideographic"
            fill="currentColor"
            className="text-zinc-500 dark:text-zinc-400"
            fontSize="10"
          >
            {xLabel}
          </text>
        ) : null}
      </svg>

      {tooltip && activeIdx != null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-black/80 px-2.5 py-1.5 text-[11px] text-zinc-900 dark:text-zinc-100 shadow-sm"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, calc(-100% - 8px))",
            maxWidth: "220px",
          }}
        >
          <div className="tabular-nums text-zinc-600 dark:text-zinc-300">{primary[activeIdx]?.label ?? ""}</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="tabular-nums font-medium">{activePrimaryValue ?? 0}</span>
            {activeSecondaryValue != null ? (
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">prev {activeSecondaryValue}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {showRangeLabels ? (
        <div className="mt-2 flex items-center text-[11px] text-zinc-600 dark:text-zinc-400">
          <span className="tabular-nums flex-1">{primary[0]?.label ?? ""}</span>
          <span className="tabular-nums flex-1 text-right">{primary[primary.length - 1]?.label ?? ""}</span>
        </div>
      ) : null}
    </div>
  );
}
