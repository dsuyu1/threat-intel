export const runtime = "edge";
export const dynamic = "force-dynamic";

import { documents, getDb, kgRelations } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { GlobeLoader } from "../../components/GlobeLoader";
import type { CountryHeat } from "../../lib/country-heat";
import { toIsoStringSafe } from "../../lib/dates";
import type { GlobalNewsItem } from "../../lib/global-news";

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

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  return code === "42P01";
}

async function getGlobalNews(): Promise<{ schemaReady: boolean; items: GlobalNewsItem[] }> {
  const db = getDb();
  try {
    const orderExpr = sql<Date>`coalesce(${documents.publishedAt}, ${documents.fetchedAt})`;
    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        url: documents.url,
        publishedAt: documents.publishedAt,
        fetchedAt: documents.fetchedAt,
      })
      .from(documents)
      .where(eq(documents.status, "ok" as any))
      .orderBy(desc(orderExpr), desc(documents.id))
      .limit(50);

    const items = rows.map((r): GlobalNewsItem => ({
      id: String(r.id),
      title: r.title ? String(r.title) : String(r.url),
      url: String(r.url),
      publishedAt: toIsoStringSafe(r.publishedAt),
      fetchedAt: toIsoStringSafe(r.fetchedAt),
    }));

    return { schemaReady: true, items };
  } catch (err) {
    if (isMissingTable(err)) return { schemaReady: false, items: [] };
    throw err;
  }
}

export default async function GlobalViewPage() {
  const [countryHeat, news] = await Promise.all([getCountryHeat(), getGlobalNews()]);
  return <GlobeLoader countryHeat={countryHeat} newsItems={news.items} newsSchemaReady={news.schemaReady} />;
}
