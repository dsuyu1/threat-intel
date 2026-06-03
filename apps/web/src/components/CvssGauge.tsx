"use client";

/**
 * CvssGauge — SVG radial gauge showing CVSS 0–10.
 * Color zones: green (low) → yellow (medium) → orange (high) → red (critical)
 * Needle animates in on mount.
 */

import { useEffect, useState } from "react";

interface Props {
  score: number | null;
  size?: number;
}

const RADIUS = 70;
const STROKE = 12;
const CENTER = 90;
// Gauge sweeps 180° (left to right across bottom half)
const START_ANGLE = 180; // degrees
const END_ANGLE = 0;

function scoreToAngle(score: number): number {
  // 0 → 180deg (left), 10 → 0deg (right)
  return 180 - (score / 10) * 180;
}

function scoreToColor(score: number): string {
  if (score >= 9) return "#ef4444"; // red-500
  if (score >= 7) return "#f97316"; // orange-500
  if (score >= 4) return "#eab308"; // yellow-500
  return "#22c55e"; // green-500
}

function scoreToLabel(score: number): string {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const s = polarToCartesian(cx, cy, r, endAngle);
  const e = polarToCartesian(cx, cy, r, startAngle);
  const large = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

// Gradient arc segments
const SEGMENTS = [
  { from: 0, to: 3.9, color: "#22c55e" },
  { from: 3.9, to: 6.9, color: "#eab308" },
  { from: 6.9, to: 8.9, color: "#f97316" },
  { from: 8.9, to: 10, color: "#ef4444" },
];

export function CvssGauge({ score, size = 180 }: Props) {
  const [displayAngle, setDisplayAngle] = useState(180); // start at 0 (left)

  useEffect(() => {
    if (score == null) return;
    // Animate needle after mount
    const t = setTimeout(() => {
      setDisplayAngle(scoreToAngle(score));
    }, 100);
    return () => clearTimeout(t);
  }, [score]);

  const vb = `0 20 180 110`;

  if (score == null) {
    return (
      <div
        style={{ width: size, height: size / 2 + 40 }}
        className="flex items-center justify-center text-gray-600 text-sm"
      >
        N/A
      </div>
    );
  }

  const color = scoreToColor(score);
  const label = scoreToLabel(score);

  // Needle tip
  const needleTip = polarToCartesian(CENTER, 90, RADIUS - 4, displayAngle + 90);
  // Needle base
  const needleLeft = polarToCartesian(CENTER, 90, 8, displayAngle + 90 - 90);
  const needleRight = polarToCartesian(CENTER, 90, 8, displayAngle + 90 + 90);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={vb}
        width={size}
        height={(size / 180) * 110}
        aria-label={`CVSS score ${score} — ${label}`}
      >
        {/* Background track */}
        <path
          d={arcPath(CENTER, 90, RADIUS, 270, 90)}
          fill="none"
          stroke="#1f2937"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />

        {/* Colored segments */}
        {SEGMENTS.map((seg) => (
          <path
            key={seg.from}
            d={arcPath(
              CENTER,
              90,
              RADIUS,
              270 - (seg.from / 10) * 180,
              270 - (seg.to / 10) * 180
            )}
            fill="none"
            stroke={seg.color}
            strokeWidth={STROKE}
            opacity={0.35}
          />
        ))}

        {/* Active arc up to score */}
        <path
          d={arcPath(CENTER, 90, RADIUS, 270, 270 - (score / 10) * 180)}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          style={{ transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        />

        {/* Needle */}
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleLeft.x},${needleLeft.y} ${needleRight.x},${needleRight.y}`}
          fill={color}
          style={{
            transformOrigin: `${CENTER}px 90px`,
            transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
        <circle cx={CENTER} cy={90} r={6} fill={color} />

        {/* Score text */}
        <text
          x={CENTER}
          y={82}
          textAnchor="middle"
          dominantBaseline="auto"
          fontSize={22}
          fontWeight="bold"
          fill="white"
        >
          {score.toFixed(1)}
        </text>

        {/* Label */}
        <text
          x={CENTER}
          y={108}
          textAnchor="middle"
          fontSize={10}
          fill={color}
          fontWeight="600"
          letterSpacing="0.05em"
        >
          {label.toUpperCase()}
        </text>

        {/* Scale labels */}
        <text x={18} y={95} fontSize={9} fill="#6b7280">
          0
        </text>
        <text x={156} y={95} fontSize={9} fill="#6b7280">
          10
        </text>
      </svg>
    </div>
  );
}
