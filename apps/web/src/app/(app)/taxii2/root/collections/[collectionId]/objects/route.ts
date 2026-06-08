export const runtime = "edge";
export const dynamic = "force-dynamic";

import { findings, getDb, kgEntities } from "@ti/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../../../lib/api-auth";
import { buildActorsBundle, buildFindingsBundle } from "../../../../../../../lib/stix";

function taxiiJson(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/taxii+json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function parseDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request, ctx: { params: Promise<{ collectionId: string }> }) {
  const auth = await requireApiKey(req, { scope: "taxii:read" });
  if (!auth.ok) return auth.res;

  const { collectionId } = await ctx.params;
  const id = String(collectionId ?? "");
  if (id !== "findings" && id !== "actors") return taxiiJson({ error: "Not found" }, { status: 404 });

  const u = new URL(req.url);
  const limit = clamp(Number(u.searchParams.get("limit") ?? 200), 1, 1000);

  const addedAfter = parseDate(u.searchParams.get("added_after"));
  const days = clamp(Number(u.searchParams.get("days") ?? 30), 1, 3650);
  const now = new Date();
  const since = addedAfter ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const db = getDb();

  if (id === "actors") {
    const rows = await db
      .select({
        actorId: kgEntities.entityId,
        name: kgEntities.name,
        aliases: kgEntities.aliases,
        description: kgEntities.description,
      })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, "actor"), gte(kgEntities.updatedAt, since)))
      .orderBy(desc(kgEntities.updatedAt))
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

    return taxiiJson({ more: false, objects: bundle.objects });
  }

  // findings
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
    .where(gte(when, since))
    .groupBy(groupKey)
    .orderBy(desc(publishedAtAgg), desc(createdAtAgg))
    .limit(limit);

  const bundle = await buildFindingsBundle({
    now,
    baseUrl: u.origin,
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

  return taxiiJson({ more: false, objects: bundle.objects });
}

