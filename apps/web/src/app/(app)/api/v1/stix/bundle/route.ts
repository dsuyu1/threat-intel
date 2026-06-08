export const runtime = "edge";
export const dynamic = "force-dynamic";

import { findings, getDb, kgEntities } from "@ti/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../../lib/api-auth";
import { buildActorsBundle, buildFindingsBundle, stixId } from "../../../../../../lib/stix";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "stix:read" });
  if (!auth.ok) return auth.res;

  const u = new URL(req.url);
  const collection = (u.searchParams.get("collection") ?? "findings").toLowerCase();
  const limit = clamp(Number(u.searchParams.get("limit") ?? 200), 1, 1000);
  const days = clamp(Number(u.searchParams.get("days") ?? 30), 1, 3650);

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const db = getDb();
  const origin = u.origin;

  const bundles: Array<{ objects: any[] }> = [];

  if (collection === "findings" || collection === "all") {
    const groupKey = sql<string>`case when ${findings.agent} = 'exploit' and ${findings.cveId} is not null then ${findings.cveId} else ${findings.id}::text end`;
    const when = sql<Date>`coalesce(${findings.publishedAt}, ${findings.createdAt})`;
    const orderByAgg = sql`order by ${findings.publishedAt} desc nulls last, ${findings.createdAt} desc, ${findings.id} desc`;
    const idAgg = sql<string>`((array_agg(${findings.id} ${orderByAgg}))[1])::text`;
    const titleAgg = sql<string>`(array_agg(${findings.title} ${orderByAgg}))[1]`;
    const summaryAgg = sql<string | null>`(array_agg(${findings.summary} ${orderByAgg}))[1]`;
    const cveIdAgg = sql<string | null>`max(${findings.cveId})`;
    const cvssAgg = sql<number | null>`max(${findings.cvssScore})`;
    const urlAgg = sql<string | null>`(array_agg(coalesce(${findings.pocUrl}, ${findings.sourceUrl}) ${orderByAgg}))[1]`;
    const publishedAtAgg = sql<Date | null>`max(${findings.publishedAt})`;
    const createdAtAgg = sql<Date | null>`max(${findings.createdAt})`;

    const rows = await db
      .select({
        id: idAgg,
        title: titleAgg,
        summary: summaryAgg,
        cveId: cveIdAgg,
        cvssScore: cvssAgg,
        sourceUrl: urlAgg,
        publishedAt: publishedAtAgg,
        createdAt: createdAtAgg,
      })
      .from(findings)
      .where(and(sql`${when} >= ${since}`, sql`${when} <= ${now}`))
      .groupBy(groupKey)
      .orderBy(desc(publishedAtAgg), desc(createdAtAgg))
      .limit(limit);

    const bundle = await buildFindingsBundle({
      now,
      baseUrl: origin,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary ?? null,
        cveId: r.cveId ?? null,
        cvssScore: r.cvssScore == null ? null : Number(r.cvssScore),
        sourceUrl: r.sourceUrl ?? null,
        publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })),
    });

    bundles.push(bundle);
  }

  if (collection === "actors" || collection === "all") {
    const rows = await db
      .select({
        actorId: kgEntities.entityId,
        name: kgEntities.name,
        aliases: kgEntities.aliases,
        description: kgEntities.description,
      })
      .from(kgEntities)
      .where(eq(kgEntities.kind, "actor"))
      .orderBy(desc(kgEntities.updatedAt), desc(kgEntities.createdAt))
      .limit(limit);

    const bundle = await buildActorsBundle({
      now,
      rows: rows.map((r) => ({
        actorId: String(r.actorId),
        name: String(r.name),
        aliases: (r.aliases ?? null) as any,
        description: r.description ?? null,
      })),
    });
    bundles.push(bundle);
  }

  if (!bundles.length) return json({ error: "Unknown collection" }, { status: 400 });
  if (bundles.length === 1) return json(bundles[0]);

  const objects = bundles.flatMap((b: any) => b.objects ?? []);
  const id = await stixId("bundle", `all:${now.toISOString()}`);
  return json({ type: "bundle", id, objects });
}
