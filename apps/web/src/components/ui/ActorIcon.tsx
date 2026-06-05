type Props = {
  seed: string;
  size?: number;
  title?: string;
  className?: string;
};

function fnv1a32(input: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

export function ActorIcon({ seed, size = 36, title, className }: Props) {
  const hash = fnv1a32(seed);
  const rand = mulberry32(hash);
  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  const clipId = `clip-${hash.toString(16)}-${safeSeed || "x"}`;

  const hue = hash % 360;
  const bg = hsl(hue, 45, 40);
  const fg = hsl((hue + 24) % 360, 80, 78);
  const fg2 = hsl((hue + 210) % 360, 65, 66);

  // 5x5 symmetric identicon
  const cells: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const on = rand() > 0.5;
      cells[y]![x] = on;
      cells[y]![4 - x] = on;
    }
  }

  // Add a couple of "accent" cells for extra uniqueness/texture.
  const accent: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
  for (let k = 0; k < 4; k += 1) {
    const ax = Math.floor(rand() * 5);
    const ay = Math.floor(rand() * 5);
    accent[ay]![ax] = true;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label={title ?? "Actor icon"}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clipId}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width="40" height="40" fill={bg} />
        <rect x="-6" y="-6" width="52" height="52" fill="none" stroke="rgba(255,255,255,0.18)" />

        {cells.map((row, y) =>
          row.map((on, x) => {
            if (!on) return null;
            const isAccent = accent[y]![x];
            const fill = isAccent ? fg2 : fg;
            return (
              <rect
                key={`${x}-${y}`}
                x={5 + x * 6}
                y={5 + y * 6}
                width={6}
                height={6}
                rx={1.2}
                fill={fill}
                opacity={isAccent ? 0.9 : 0.85}
              />
            );
          })
        )}
      </g>
    </svg>
  );
}
