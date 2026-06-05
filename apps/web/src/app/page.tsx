export const runtime = "edge";

import { getDb, kgRelations } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { GlobeLoader } from "../components/GlobeLoader";
import type { CountryHeat } from "../lib/country-heat";
import { toIsoStringSafe } from "../lib/dates";

async function getCountryHeat(): Promise<CountryHeat[]> {
  const db = getDb();
  const rows = await db
    .select({
      iso2: kgRelations.toId,
      heat: sql<number>`sum(${kgRelations.support})`,
      actorCount: sql<number>`count(distinct ${kgRelations.fromId})`,
      lastSeen: sql<string | Date | null>`max(${kgRelations.lastSeen})`,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, "actor_origin_country"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "country")
      )
    )
    .groupBy(kgRelations.toId)
    .orderBy(desc(sql`max(${kgRelations.lastSeen})`))
    .limit(300);

  return rows.map((r) => ({
    iso2: r.iso2,
    heat: Number(r.heat ?? 0),
    actorCount: Number(r.actorCount ?? 0),
    lastSeen: toIsoStringSafe(r.lastSeen),
  }));
}

export default async function HomePage() {
  const countryHeat = await getCountryHeat();
  return <GlobeLoader countryHeat={countryHeat} />;
}
