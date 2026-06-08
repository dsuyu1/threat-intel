"use client";

import { useMemo, useRef, useState } from "react";

type LineDatum = { label: string; value: number };

function linePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function DualLineChart({
  primary,
  secondary,
  height = 240,
}: {
  primary: LineDatum[];
  secondary?: LineDatum[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<null | { idx: number; xPx: number; yPx: number }>(null);

  const geom = useMemo(() => {
    const a = primary.map((d) => Math.max(0, Number(d.value ?? 0)));
    const b = (secondary ?? []).map((d) => Math.max(0, Number(d.value ?? 0)));
    const n = Math.max(1, primary.length, secondary?.length ?? 0);

    const max = Math.max(1, ...a, ...b);
    const w = 640;
    const h = 220;
    const padX = 16;
    const padY = 18;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;

    const toPoints = (vals: number[]) => {
      const out: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) {
        const v = vals[i] ?? 0;
        const x = padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
        const y = padY + (1 - v / max) * innerH;
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
          `M ${p1[0]!.x.toFixed(2)} ${(padY + innerH).toFixed(2)}`,
          ...p1.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
          `L ${p1[p1.length - 1]!.x.toFixed(2)} ${(padY + innerH).toFixed(2)}`,
          "Z",
        ].join(" ")
      : "";

    return { a, b, n, max, w, h, padX, padY, innerW, innerH, p1, p2, d1, d2, area };
  }, [primary, secondary]);

  const activeIdx = hover?.idx ?? null;
  const activePrimaryValue = activeIdx != null ? Number(primary[activeIdx]?.value ?? 0) : null;
  const activeSecondaryValue =
    activeIdx != null && secondary?.length ? Number(secondary[activeIdx]?.value ?? 0) : null;

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((ev.clientX - rect.left) / rect.width) * geom.w;
    const t = (x - geom.padX) / Math.max(1, geom.innerW);
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
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Trend chart"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          <linearGradient id="dualLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(79 70 229)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="rgb(79 70 229)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={geom.w} height={geom.h} rx="14" fill="transparent" />

        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={geom.padX}
            x2={geom.w - geom.padX}
            y1={geom.padY + geom.innerH * t}
            y2={geom.padY + geom.innerH * t}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="1"
            className="dark:stroke-white/10"
          />
        ))}

        {geom.area ? <path d={geom.area} fill="url(#dualLineFill)" /> : null}
        {geom.d2 ? <path d={geom.d2} fill="none" stroke="rgba(79,70,229,0.35)" strokeWidth="2" /> : null}
        {geom.d1 ? <path d={geom.d1} fill="none" stroke="rgb(79 70 229)" strokeWidth="2.5" /> : null}

        {geom.p1.length ? (
          <circle cx={geom.p1[geom.p1.length - 1]!.x} cy={geom.p1[geom.p1.length - 1]!.y} r="3.5" fill="rgb(79 70 229)" />
        ) : null}

        {activeIdx != null && geom.p1[activeIdx] ? (
          <>
            <line
              x1={geom.p1[activeIdx]!.x}
              x2={geom.p1[activeIdx]!.x}
              y1={geom.padY}
              y2={geom.padY + geom.innerH}
              stroke="rgba(79,70,229,0.22)"
              strokeWidth="1"
            />
            <circle cx={geom.p1[activeIdx]!.x} cy={geom.p1[activeIdx]!.y} r="4" fill="rgb(79 70 229)" />
            {secondary && geom.p2[activeIdx] ? (
              <circle cx={geom.p2[activeIdx]!.x} cy={geom.p2[activeIdx]!.y} r="3.5" fill="rgba(79,70,229,0.55)" />
            ) : null}
          </>
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

      <div className="mt-2 flex items-center text-[11px] text-zinc-600 dark:text-zinc-400">
        <span className="tabular-nums flex-1">{primary[0]?.label ?? ""}</span>
        <span className="tabular-nums flex-1 text-right">{primary[primary.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

