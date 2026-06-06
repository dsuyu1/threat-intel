"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type TtpFlowEdge = {
  from: string;
  to: string;
  kind: "down" | "right";
};

type Line = {
  key: string;
  d: string;
};

function bezierPath(params: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "down" | "right";
}) {
  const { x1, y1, x2, y2, kind } = params;
  const dx = Math.max(24, Math.min(120, Math.abs(x2 - x1) * 0.35));
  const dy = Math.max(24, Math.min(120, Math.abs(y2 - y1) * 0.35));

  if (kind === "down") {
    const c1x = x1;
    const c1y = y1 + dy;
    const c2x = x2;
    const c2y = y2 - dy;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(
      2
    )} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  const c1x = x1 + dx;
  const c1y = y1;
  const c2x = x2 - dx;
  const c2y = y2;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(
    2
  )} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function getAnchorPoints(params: {
  fromRect: DOMRect;
  toRect: DOMRect;
  containerRect: DOMRect;
  kind: "down" | "right";
}) {
  const pad = 2;

  const toLocal = (r: DOMRect) => ({
    left: r.left - params.containerRect.left,
    top: r.top - params.containerRect.top,
    right: r.right - params.containerRect.left,
    bottom: r.bottom - params.containerRect.top,
    cx: r.left - params.containerRect.left + r.width / 2,
    cy: r.top - params.containerRect.top + r.height / 2,
  });

  const a = toLocal(params.fromRect);
  const b = toLocal(params.toRect);

  if (params.kind === "down") {
    return {
      x1: a.cx,
      y1: a.bottom + pad,
      x2: b.cx,
      y2: b.top - pad,
    };
  }

  return {
    x1: a.right + pad,
    y1: a.cy,
    x2: b.left - pad,
    y2: b.cy,
  };
}

export function TtpFlowCanvas({
  edges,
  children,
}: {
  edges: TtpFlowEdge[];
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const w = Math.max(0, Math.ceil(container.scrollWidth));
        const h = Math.max(0, Math.ceil(container.scrollHeight));
        setSize({ w, h });

        const next: Line[] = [];
        for (const e of edges) {
          const fromEl = document.getElementById(e.from);
          const toEl = document.getElementById(e.to);
          if (!fromEl || !toEl) continue;
          if (!container.contains(fromEl) || !container.contains(toEl)) continue;

          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();
          if (!fromRect.width || !fromRect.height || !toRect.width || !toRect.height) continue;

          const { x1, y1, x2, y2 } = getAnchorPoints({ fromRect, toRect, containerRect, kind: e.kind });
          next.push({
            key: `${e.from}=>${e.to}`,
            d: bezierPath({ x1, y1, x2, y2, kind: e.kind }),
          });
        }
        setLines(next);
      });
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => compute());
      ro.observe(el);
    }

    window.addEventListener("resize", compute);
    compute();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", compute);
      ro?.disconnect();
    };
  }, [edges]);

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={size.w || 1}
        height={size.h || 1}
        viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="ttpFlowArrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(59,130,246,0.75)" />
          </marker>
        </defs>
        {lines.map((l) => (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke="rgba(59,130,246,0.35)"
            strokeWidth="2"
            markerEnd="url(#ttpFlowArrow)"
          />
        ))}
      </svg>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
