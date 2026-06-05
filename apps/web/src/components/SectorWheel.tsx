"use client";

type Sector = {
  id: string;
  label: string;
  weight: number;
};

const PALETTE = [
  "#0ea5e9", // sky
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#a855f7", // purple
  "#14b8a6", // teal
  "#f43f5e", // rose
  "#84cc16", // lime
  "#06b6d4", // cyan
];

function hashToIndex(input: string, modulo: number) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % modulo;
}

function colorForSector(id: string) {
  return PALETTE[hashToIndex(id, PALETTE.length)]!;
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const full = Math.abs(end - start) >= Math.PI * 2 - 1e-6;
  if (full) {
    // A full circle needs special casing (two arcs).
    const p1 = polarToCartesian(cx, cy, r, 0);
    const p2 = polarToCartesian(cx, cy, r, Math.PI);
    return [
      `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
      `A ${r} ${r} 0 1 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
      `A ${r} ${r} 0 1 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
      "Z",
    ].join(" ");
  }

  const p0 = polarToCartesian(cx, cy, r, start);
  const p1 = polarToCartesian(cx, cy, r, end);
  const largeArcFlag = end - start > Math.PI ? 1 : 0;

  return [
    `M ${cx} ${cy}`,
    `L ${p0.x.toFixed(3)} ${p0.y.toFixed(3)}`,
    `A ${r} ${r} 0 ${largeArcFlag} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

export function SectorWheel({ sectors }: { sectors: Sector[] }) {
  const items = sectors
    .map((s) => ({ ...s, weight: Number.isFinite(s.weight) ? Math.max(0, s.weight) : 0 }))
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
        No sector attributions yet.
      </div>
    );
  }

  const total = items.reduce((acc, s) => acc + s.weight, 0) || 1;

  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = 110;

  // Start at 12 o'clock.
  let cur = -Math.PI / 2;
  const slices = items.map((s) => {
    const frac = s.weight / total;
    const start = cur;
    const end = cur + frac * Math.PI * 2;
    cur = end;
    return { ...s, frac, start, end, color: colorForSector(s.id) };
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-[260px] h-[260px] shrink-0"
          role="img"
          aria-label="Target sectors pie chart"
        >
          {slices.map((s) => (
            <path key={s.id} d={arcPath(cx, cy, r, s.start, s.end)} fill={s.color} />
          ))}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.10)" />
        </svg>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {slices.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="text-zinc-900 dark:text-zinc-200 truncate">{s.label}</span>
            </div>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
              {Math.round(s.frac * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

