interface Props {
  score: number;
  className?: string;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function CvssVolumeBar({ score, className }: Props) {
  const normalized = clamp01(score / 10);
  const pct = `${Math.round(normalized * 1000) / 10}%`;

  return (
    <div
      className={
        "relative overflow-hidden rounded-full border border-gray-700 bg-gray-800/60 " +
        (className ?? "")
      }
      aria-label={`CVSS ${score.toFixed(1)} (${pct})`}
      title={`CVSS ${score.toFixed(1)}`}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500"
        style={{ height: pct }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(to_top,rgba(255,255,255,0.12)_1px,transparent_1px)] opacity-20"
        style={{ backgroundSize: "100% 10%" }}
        aria-hidden="true"
      />
    </div>
  );
}

