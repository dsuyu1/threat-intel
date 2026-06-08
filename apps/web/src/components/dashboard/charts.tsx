export { DualLineChart } from "./DualLineChart";

type SparkDatum = { label: string; value: number };

export function SparkBars({
  data,
  height = 72,
}: {
  data: SparkDatum[];
  height?: number;
}) {
  const values = data.map((d) => Math.max(0, Number(d.value ?? 0)));
  const max = Math.max(1, ...values);
  const sorted = [...values].sort((a, b) => a - b);
  const secondMax = sorted.length >= 2 ? sorted[sorted.length - 2]! : 0;
  const spikeRatio = secondMax > 0 ? max / secondMax : max;
  const useLogScale = max >= 25 && spikeRatio >= 6;
  const scaled = values.map((v) => (useLogScale ? Math.log1p(v) : v));
  const scaledMax = Math.max(1, ...scaled);
  const spikeIndex = useLogScale ? values.indexOf(max) : -1;
  const w = 240;
  const h = 48;
  const pad = 2;
  const barW = w / Math.max(1, data.length);

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Spark bar chart"
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width={w}
          height={h}
          rx="10"
          fill="transparent"
        />
        {data.map((d, i) => {
          const sv = scaled[i] ?? 0;
          const barH = Math.max(1, Math.round((sv / scaledMax) * (h - pad * 2)));
          const x = i * barW + pad;
          const y = h - pad - barH;
          const rw = Math.max(1, barW - pad * 2);
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={y}
                width={rw}
                height={barH}
                rx="2"
                fill="url(#sparkFill)"
              >
                <title>
                  {d.label}: {values[i] ?? 0}
                </title>
              </rect>
              {i === spikeIndex ? (
                <text
                  x={x + rw / 2}
                  y={Math.max(2, y - 2)}
                  textAnchor="middle"
                  dominantBaseline="ideographic"
                  fill="currentColor"
                  className="text-zinc-600 dark:text-zinc-300"
                  fontSize="7"
                >
                  batch
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center text-[11px] text-zinc-600 dark:text-zinc-400">
        <span className="tabular-nums flex-1">{data[0]?.label ?? ""}</span>
        <span className="flex-1 text-center">
          {useLogScale ? "Spike normalized" : ""}
        </span>
        <span className="tabular-nums flex-1 text-right">
          {data[data.length - 1]?.label ?? ""}
        </span>
      </div>
    </div>
  );
}

type DonutSegment = { label: string; value: number; color: string };

export function DonutChart({
  title,
  segments,
}: {
  title?: string;
  segments: DonutSegment[];
}) {
  const rawTotal = segments.reduce((acc, s) => acc + s.value, 0);
  const total = rawTotal || 1;
  let offset = 25; // rotate so first segment starts at top

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0" role="img">
        {title ? <title>{title}</title> : null}
        <circle
          cx="21"
          cy="21"
          r="15.915"
          fill="transparent"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="7"
          className="dark:stroke-white/10"
        />
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          const dash = `${pct} ${100 - pct}`;
          const el = (
            <circle
              key={s.label}
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke={s.color}
              strokeWidth="7"
              strokeDasharray={dash}
              strokeDashoffset={offset}
              strokeLinecap="butt"
            />
          );
          offset -= pct;
          return el;
        })}
        {rawTotal === 0 ? (
          <text
            x="21"
            y="21"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="currentColor"
            className="text-[6px] text-zinc-500 dark:text-zinc-400"
          >
            No data
          </text>
        ) : null}
      </svg>

      <div className="min-w-0">
        <div className="text-xs font-medium tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
          Mix
        </div>
        <div className="mt-2 space-y-1">
          {segments.some((s) => s.value > 0) ? (
            segments
              .filter((s) => s.value > 0)
              .sort((a, b) => b.value - a.value)
              .map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-zinc-800 dark:text-zinc-200">{s.label}</span>
                  <span className="ml-auto tabular-nums text-zinc-600 dark:text-zinc-400">
                    {s.value}
                  </span>
                </div>
              ))
          ) : (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              No findings yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HorizontalBarRow = { label: string; value: number };

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function HorizontalBars({
  rows,
}: {
  rows: HorizontalBarRow[];
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.value ?? 0)));

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = `${Math.max(0, Math.min(100, (r.value / max) * 100)).toFixed(1)}%`;
        return (
          <div key={r.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="text-zinc-700 dark:text-zinc-300 truncate">
                {r.label}
              </div>
              <div className="tabular-nums text-zinc-600 dark:text-zinc-400">
                {nf(r.value)}
              </div>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-zinc-200/70 dark:bg-zinc-800/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500/60 to-indigo-500/25"
                style={{ width: pct }}
                aria-hidden="true"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
