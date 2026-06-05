type Facet = {
  label: string;
  value: string;
  sub?: string | null;
};

function points(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * (Math.PI / 180);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

export function ControlPentagon({ facets }: { facets: Facet[] }) {
  const pts = points(110, 110, 84);
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="bg-white/70 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
          Control Pentagon
        </h2>
        <span className="text-xs text-zinc-500">evidence-first</span>
      </div>

      <div className="mt-3 flex flex-col md:flex-row gap-4">
        <svg
          viewBox="0 0 220 220"
          className="w-full md:w-64 shrink-0"
          aria-label="Control Pentagon"
        >
          <polygon
            points={poly}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-zinc-300 dark:text-zinc-700"
          />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="5" fill="#0ea5e9" opacity="0.9" />
              <text
                x={p.x}
                y={p.y + (i === 0 ? -12 : i === 2 ? 18 : 14)}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                className="text-zinc-500 dark:text-zinc-400"
              >
                {facets[i]?.label ?? ""}
              </text>
              <text
                x={p.x}
                y={p.y + (i === 0 ? 2 : i === 2 ? 32 : 26)}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
                className="text-zinc-900 dark:text-zinc-100"
              >
                {facets[i]?.value ?? ""}
              </text>
            </g>
          ))}
        </svg>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {facets.map((f) => (
            <div
              key={f.label}
              className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
            >
              <div className="text-xs text-zinc-500">{f.label}</div>
              <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums">
                {f.value}
              </div>
              {f.sub ? <div className="mt-1 text-xs text-zinc-500">{f.sub}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
