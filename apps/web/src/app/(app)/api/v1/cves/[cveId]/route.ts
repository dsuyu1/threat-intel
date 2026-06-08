export const runtime = "edge";
export const dynamic = "force-dynamic";

import { findings, getDb, kgEntities, kgRelations } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireApiKey } from "../../../../../../lib/api-auth";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function safeIso(d: Date | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

function normalizeCveId(raw: string) {
  const v = String(raw ?? "").trim().toUpperCase();
  return /^CVE-\d{4}-\d{4,}$/.test(v) ? v : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ cveId: string }> }) {
  const auth = await requireApiKey(req, { scope: "cves:read" });
  if (!auth.ok) return auth.res;

  const { cveId: cveIdRaw } = await ctx.params;
  const cveId = normalizeCveId(cveIdRaw ?? "");
  if (!cveId) return json({ error: "Invalid CVE ID" }, { status: 400 });

  const db = getDb();

  const [cveEntity] = await db
    .select({
      id: kgEntities.entityId,
      name: kgEntities.name,
      description: kgEntities.description,
      attributes: kgEntities.attributes,
      updatedAt: kgEntities.updatedAt,
      createdAt: kgEntities.createdAt,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "cve"), eq(kgEntities.entityId, cveId)))
    .limit(1);

  if (!cveEntity?.id) return json({ error: "CVE not found" }, { status: 404 });

  const attrs: any = cveEntity.attributes ?? null;
  const kev = attrs?.kev ?? null;

  const orderByFinding = sql`order by ${findings.publishedAt} desc nulls last, ${findings.createdAt} desc, ${findings.id} desc`;
  const urlAgg = sql<string | null>`(array_agg(coalesce(${findings.pocUrl}, ${findings.sourceUrl}) ${orderByFinding}) filter (where coalesce(${findings.pocUrl}, ${findings.sourceUrl}) is not null))[1]`;
  const titleAgg = sql<string | null>`(array_agg(${findings.title} ${orderByFinding}))[1]`;
  const idAgg = sql<string | null>`((array_agg(${findings.id} ${orderByFinding}))[1])::text`;

  const epssOrder = sql`order by ${findings.epssUpdatedAt} desc nulls last, ${findings.publishedAt} desc nulls last, ${findings.createdAt} desc`;
  const epssScoreAgg = sql<string | null>`(array_agg(${findings.epssScore} ${epssOrder}) filter (where ${findings.epssScore} is not null))[1]::text`;
  const epssPctAgg = sql<string | null>`(array_agg(${findings.epssPercentile} ${epssOrder}) filter (where ${findings.epssPercentile} is not null))[1]::text`;
  const epssUpdatedAtAgg = sql<Date | null>`max(${findings.epssUpdatedAt})`;

  const cvssVectorAgg = sql<string | null>`(array_agg(${findings.cvssVector} ${orderByFinding}) filter (where ${findings.cvssVector} is not null))[1]`;
  const cvssScoreAgg = sql<string | null>`(max(${findings.cvssScore}))::text`;
  const disclosureToExploitAgg = sql<string | null>`(max(${findings.disclosureToExploitHours}))::text`;

  const [enrichment] = await db
    .select({
      maxCvssScore: cvssScoreAgg,
      latestCvssVector: cvssVectorAgg,
      epssScore: epssScoreAgg,
      epssPercentile: epssPctAgg,
      epssUpdatedAt: epssUpdatedAtAgg,
      disclosureToExploitHours: disclosureToExploitAgg,
      latestFindingId: idAgg,
      latestFindingTitle: titleAgg,
      latestFindingUrl: urlAgg,
    })
    .from(findings)
    .where(eq(findings.cveId, cveId));

  const relatedFindings = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      epssScore: findings.epssScore,
      epssPercentile: findings.epssPercentile,
      epssUpdatedAt: findings.epssUpdatedAt,
      disclosureToExploitHours: findings.disclosureToExploitHours,
      sourceUrl: findings.sourceUrl,
      pocUrl: findings.pocUrl,
      publishedAt: findings.publishedAt,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .where(eq(findings.cveId, cveId))
    .orderBy(desc(findings.publishedAt), desc(findings.createdAt), asc(findings.id))
    .limit(10);

  const actorEnt = alias(kgEntities, "actor_ent");
  const exploitedByActors = await db
    .select({
      actorId: actorEnt.entityId,
      name: actorEnt.name,
      description: actorEnt.description,
    })
    .from(kgRelations)
    .innerJoin(
      actorEnt,
      and(eq(actorEnt.kind, "actor"), eq(actorEnt.entityId, kgRelations.fromId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_exploits_cve"),
        eq(kgRelations.toKind, "cve"),
        eq(kgRelations.toId, cveId),
        eq(kgRelations.fromKind, "actor")
      )
    )
    .orderBy(asc(actorEnt.name))
    .limit(100);

  return json({
    ok: true,
    cve: {
      id: cveEntity.id,
      name: cveEntity.name,
      description: cveEntity.description ?? null,
      attributes: (cveEntity.attributes ?? null) as any,
      createdAt: safeIso(cveEntity.createdAt as any),
      updatedAt: safeIso(cveEntity.updatedAt as any),
    },
    epss: {
      score: enrichment?.epssScore ?? null,
      percentile: enrichment?.epssPercentile ?? null,
      updatedAt: safeIso(enrichment?.epssUpdatedAt as any),
    },
    kev: kev ? (kev as any) : null,
    isKev: Boolean(kev),
    enrichment: {
      cvssScore: enrichment?.maxCvssScore ?? null,
      cvssVector: enrichment?.latestCvssVector ?? null,
      disclosureToExploitHours: enrichment?.disclosureToExploitHours ?? null,
      latestFinding: enrichment?.latestFindingId
        ? {
            id: enrichment.latestFindingId,
            title: enrichment.latestFindingTitle ?? null,
            url: enrichment.latestFindingUrl ?? null,
          }
        : null,
    },
    exploitedByActors: exploitedByActors.map((a) => ({
      actorId: a.actorId,
      name: a.name,
      description: a.description ?? null,
    })),
    relatedFindings: relatedFindings.map((f) => ({
      id: f.id,
      agent: String(f.agent),
      title: f.title,
      summary: f.summary ?? null,
      severity: f.severity ? String(f.severity) : null,
      cvssScore: f.cvssScore ? String(f.cvssScore) : null,
      cvssVector: f.cvssVector ?? null,
      epssScore: f.epssScore ? String(f.epssScore) : null,
      epssPercentile: f.epssPercentile ? String(f.epssPercentile) : null,
      epssUpdatedAt: safeIso(f.epssUpdatedAt as any),
      disclosureToExploitHours: f.disclosureToExploitHours ? String(f.disclosureToExploitHours) : null,
      sourceUrl: f.sourceUrl ?? null,
      pocUrl: f.pocUrl ?? null,
      publishedAt: safeIso(f.publishedAt as any),
      createdAt: safeIso(f.createdAt as any),
    })),
  });
}
