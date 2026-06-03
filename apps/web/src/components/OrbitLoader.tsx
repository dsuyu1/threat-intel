"use client";

/**
 * Orbit loading animation — faithful CSS port of NVActivityIndicatorView #30 (Orbit).
 *
 * Original: https://github.com/ninjaprox/NVActivityIndicatorView
 * Sources/Base/Animations/NVActivityIndicatorAnimationOrbit.swift
 *
 * Elements (original proportions preserved):
 *   coreSize      = size / (1 + 0.25 + 1.5)  = size / 2.75
 *   satelliteSize = coreSize * 0.25
 *   orbitRadius   = (size - satelliteSize) / 2
 *
 * Timings:
 *   core + rings  → 1.9 s
 *   satellite     → 3.8 s  (2 full orbits, matches original duration * 2)
 */

interface Props {
  size?: number;
  color?: string;
}

export function OrbitLoader({ size = 60, color = "#ffffff" }: Props) {
  const coreSize      = size / 2.75;
  const satelliteSize = coreSize * 0.25;
  const orbitRadius   = (size - satelliteSize) / 2;
  const center        = size / 2;

  // Core sits centred; satellite starts at top (−90 °) and does 2 CW revolutions
  const coreLTWH = {
    left:   center - coreSize / 2,
    top:    center - coreSize / 2,
    width:  coreSize,
    height: coreSize,
  };

  return (
    <>
      <style>{`
        /* ── Core pulse: 1→1.3→1.3→1 ── */
        @keyframes nv-orbit-core {
          0%   { transform: scale(1);   }
          45%  { transform: scale(1.3); }
          55%  { transform: scale(1.3); }
          100% { transform: scale(1);   }
        }

        /* ── Ring 1: appears at 45 %, expands 1.3→2, fades out ── */
        @keyframes nv-orbit-ring1 {
          0%   { transform: scale(0);   opacity: 0.8; }
          44%  { transform: scale(0);   opacity: 0.8; }
          45%  { transform: scale(1.3); opacity: 0.8; }
          100% { transform: scale(2);   opacity: 0;   }
        }

        /* ── Ring 2: appears at 55 %, expands 1.3→2.1, fades out faster ── */
        @keyframes nv-orbit-ring2 {
          0%   { transform: scale(0);   opacity: 0.7; }
          54%  { transform: scale(0);   opacity: 0.7; }
          55%  { transform: scale(1.3); opacity: 0.7; }
          65%  { transform: scale(1.3); opacity: 0;   }
          100% { transform: scale(2.1); opacity: 0;   }
        }

        /* ── Satellite: starts at top (−90 °), 2 full CW orbits ── */
        @keyframes nv-orbit-satellite {
          from { transform: rotate(-90deg) translateX(var(--orbit-r)) rotate(90deg);  }
          to   { transform: rotate(630deg) translateX(var(--orbit-r)) rotate(-630deg); }
        }
      `}</style>

      <div style={{ position: "relative", width: size, height: size }}>

        {/* Ring 1 */}
        <div style={{
          position: "absolute", borderRadius: "50%",
          backgroundColor: color,
          ...coreLTWH,
          transformOrigin: "50% 50%",
          animation: "nv-orbit-ring1 1.9s linear infinite",
        }} />

        {/* Ring 2 */}
        <div style={{
          position: "absolute", borderRadius: "50%",
          backgroundColor: color,
          ...coreLTWH,
          transformOrigin: "50% 50%",
          animation: "nv-orbit-ring2 1.9s linear infinite",
        }} />

        {/* Core */}
        <div style={{
          position: "absolute", borderRadius: "50%",
          backgroundColor: color,
          ...coreLTWH,
          transformOrigin: "50% 50%",
          animation: "nv-orbit-core 1.9s linear infinite",
        }} />

        {/* Satellite — centred, orbits via rotate+translateX */}
        <div style={{
          position: "absolute",
          width:  satelliteSize,
          height: satelliteSize,
          left:   center - satelliteSize / 2,
          top:    center - satelliteSize / 2,
          borderRadius: "50%",
          backgroundColor: color,
          transformOrigin: "50% 50%",
          // Pass orbit radius as CSS var so the keyframe can use it
          ["--orbit-r" as string]: `${orbitRadius}px`,
          animation: "nv-orbit-satellite 3.8s linear infinite",
        }} />

      </div>
    </>
  );
}
