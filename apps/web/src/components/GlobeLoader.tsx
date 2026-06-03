"use client";

import dynamic from "next/dynamic";
import type { MapFinding } from "./ThreatMap";
import { OrbitLoader } from "./OrbitLoader";

const GlobeHero = dynamic(
  () => import("./GlobeHero").then(m => ({ default: m.GlobeHero })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#09090b] flex items-center justify-center">
        <OrbitLoader size={60} color="#ffffff" />
      </div>
    ),
  }
);

export function GlobeLoader({ findings }: { findings: MapFinding[] }) {
  return <GlobeHero findings={findings} />;
}
