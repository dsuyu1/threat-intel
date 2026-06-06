"use client";

import dynamic from "next/dynamic";
import { OrbitLoader } from "./OrbitLoader";
import type { CountryHeat } from "../lib/country-heat";
import type { GlobalNewsItem } from "../lib/global-news";

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

export function GlobeLoader({
  countryHeat,
  newsItems,
  newsSchemaReady,
}: {
  countryHeat: CountryHeat[];
  newsItems: GlobalNewsItem[];
  newsSchemaReady: boolean;
}) {
  return <GlobeHero countryHeat={countryHeat} newsItems={newsItems} newsSchemaReady={newsSchemaReady} />;
}
