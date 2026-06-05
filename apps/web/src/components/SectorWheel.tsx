type Sector = {
  id: string;
  label: string;
  weight: number;
};

const COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
  "#f43f5e",
  "#84cc16",
  "#06b6d4",
];

export function SectorWheel({ sectors }: { sectors: Sector[] }) {
  if (!sectors.length) {
    return (
      <div className="bg-white/70 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
          Sector Wheel
        </h2>
        <p className="mt-2 text-sm text-zinc-500">No sector targeting data yet.</p>
      </div>
    );
  }

  const total = sectors.reduce((acc, s) => acc + Math.max(0, s.weight), 0) || 1;
  let cur = 0;
  const stops = sectors.map((s, idx) => {
    const start = cur;
    const pct = (Math.max(0, s.weight) / total) * 100;
    cur += pct;
    const end = cur;
    const color = COLORS[idx % COLORS.length]!;
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  return (
    <div className="bg-white/70 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
          Sector Wheel
        </h2>
        <span className="text-xs text-zinc-500">decayed weight</span>
      </div>

      <div className="mt-4 flex flex-col md:flex-row gap-4">
        <div className="w-full md:w-60 shrink-0 flex items-center justify-center">
          <div
            className="w-52 h-52 rounded-full"
            style={{ background: `conic-gradient(${stops.join(", ")})` }}
            aria-label="Sector wheel"
          >
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-28 h-28 rounded-full bg-white dark:bg-[#141414] border border-zinc-200 dark:border-zinc-800" />
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          {sectors.map((s, idx) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: COLORS[idx % COLORS.length] }}
                />
                <span className="text-zinc-900 dark:text-zinc-200">{s.label}</span>
              </div>
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                {s.weight.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
