"use client";

/**
 * ThreatMapLoader — wraps ThreatMap in a Suspense boundary.
 * Next.js requires dynamic imports for components that use browser APIs (D3, ResizeObserver).
 */

import dynamic from "next/dynamic";
import type { MapFinding } from "./ThreatMap";

const ThreatMap = dynamic(
  () => import("./ThreatMap").then((m) => ({ default: m.ThreatMap })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full aspect-[1.92/1] rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
        <span className="text-xs text-zinc-600 animate-pulse">
          Loading threat map...
        </span>
      </div>
    ),
  }
);

export function ThreatMapLoader({ findings }: { findings: MapFinding[] }) {
  return <ThreatMap findings={findings} />;
}
