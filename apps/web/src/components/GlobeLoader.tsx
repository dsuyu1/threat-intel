"use client";

import dynamic from "next/dynamic";
import { OrbitLoader } from "./OrbitLoader";
import type { CountryHeat } from "../lib/country-heat";

const GlobeHero = dynamic(
  () => import("./GlobeHero").then(m => ({ default: m.GlobeHero })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-white dark:bg-[#0b0b0d] text-zinc-900 dark:text-white flex items-center justify-center">
        <OrbitLoader size={60} color="currentColor" />
      </div>
    ),
  }
);

export function GlobeLoader({ countryHeat }: { countryHeat: CountryHeat[] }) {
  return <GlobeHero countryHeat={countryHeat} />;
}
