export const runtime = "edge";

import { findings, getDb, kgEntities, kgRelations } from "@ti/db";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const MITRE_TECHNIQUE_ID_RE = /^T\d{4}(?:\.\d{3})?$/i;

function normalizeTechniqueId(value: unknown) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (!MITRE_TECHNIQUE_ID_RE.test(v)) return "";
  return v.toUpperCase();
}

function parseDays(value: unknown) {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return 90;
  const i = Math.floor(n);
  return i > 0 && i <= 365 ? i : 90;
}

function parseTactics(attributes: unknown): { tactics: string[]; tacticLabels: string[] } {
  const anyAttrs = attributes as any;
  const tactics = Array.isArray(anyAttrs?.tactics) ? anyAttrs.tactics.map((x: any) => String(x)) : [];
  const tacticLabels = Array.isArray(anyAttrs?.tacticLabels)
    ? anyAttrs.tacticLabels.map((x: any) => String(x))
    : [];
  return {
    tactics: tactics.filter(Boolean),
    tacticLabels: tacticLabels.filter(Boolean),
  };
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const url = new URL(req.url);
  const techniqueId = normalizeTechniqueId(url.searchParams.get("techniqueId"));
  const days = parseDays(url.searchParams.get("days"));
  if (!techniqueId) return json({ error: "techniqueId is required (e.g. T1059 or T1059.001)" }, { status: 400 });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [tech] = await db
    .select({
      id: kgEntities.entityId,
      name: kgEntities.name,
      description: kgEntities.description,
      attributes: kgEntities.attributes,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "technique"), eq(kgEntities.entityId, techniqueId)))
    .limit(1);

  const tacticMeta = parseTactics(tech?.attributes);

  const topActors = await db
    .select({
      id: kgEntities.entityId,
      name: kgEntities.name,
    })
    .from(kgRelations)
    .innerJoin(
      kgEntities,
      and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, kgRelations.fromId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_uses_technique"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "technique"),
        eq(kgRelations.toId, techniqueId)
      )
    )
    .orderBy(asc(kgEntities.name))
    .limit(50);

  const mitigations = await db
    .select({
      id: kgEntities.entityId,
      name: kgEntities.name,
    })
    .from(kgRelations)
    .innerJoin(
      kgEntities,
      and(eq(kgEntities.kind, "mitigation"), eq(kgEntities.entityId, kgRelations.toId))
    )
    .where(
      and(
        eq(kgRelations.type, "technique_mitigated_by"),
        eq(kgRelations.fromKind, "technique"),
        eq(kgRelations.fromId, techniqueId),
        eq(kgRelations.toKind, "mitigation")
      )
    )
    .orderBy(asc(kgEntities.name))
    .limit(200);

  const mitigationIds = mitigations.map((m) => m.id);

  const d3Rows =
    mitigationIds.length === 0
      ? []
      : await db
          .select({
            mitigationId: kgRelations.fromId,
            d3Id: kgEntities.entityId,
            d3Name: kgEntities.name,
            d3Attributes: kgEntities.attributes,
          })
          .from(kgRelations)
          .innerJoin(
            kgEntities,
            and(eq(kgEntities.kind, "d3fend_technique"), eq(kgEntities.entityId, kgRelations.toId))
          )
          .where(
            and(
              eq(kgRelations.type, "mitigation_mapped_to_d3fend"),
              eq(kgRelations.fromKind, "mitigation"),
              eq(kgRelations.toKind, "d3fend_technique"),
              inArray(kgRelations.fromId, mitigationIds)
            )
          )
          .orderBy(asc(kgEntities.name));

  const mitigationNameById = new Map(mitigations.map((m) => [m.id, m.name] as const));
  const viaMap = new Map<string, Array<{ id: string; name: string }>>();
  const d3Unique = new Map<string, { id: string; name: string; url: string | null; category: string | null }>();

  for (const r of d3Rows) {
    const d3Attrs = r.d3Attributes as any;
    const entry = { id: r.d3Id, name: r.d3Name };
    const arr = viaMap.get(r.mitigationId) ?? [];
    arr.push(entry);
    viaMap.set(r.mitigationId, arr);
    if (!d3Unique.has(r.d3Id)) {
      d3Unique.set(r.d3Id, {
        id: r.d3Id,
        name: r.d3Name,
        url: d3Attrs?.url ? String(d3Attrs.url) : null,
        category: d3Attrs?.category ? String(d3Attrs.category) : null,
      });
    }
  }

  const viaMitigations = Array.from(viaMap.entries())
    .map(([mitigationId, d3fend]) => ({
      mitigationId,
      mitigationName: mitigationNameById.get(mitigationId) ?? mitigationId,
      d3fend: d3fend
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((x, idx, arr) => arr.findIndex((y) => y.id === x.id) === idx),
    }))
    .sort((a, b) => a.mitigationId.localeCompare(b.mitigationId));

  const d3fendTechniques = Array.from(d3Unique.values()).sort((a, b) => a.id.localeCompare(b.id));

  const mitreCond = sql<boolean>`(',' || COALESCE(${findings.mitreIds}, '') || ',') ILIKE '%,' || ${techniqueId} || ',%'`;
  const dateCond = sql<boolean>`COALESCE(${findings.publishedAt}, ${findings.createdAt}) >= ${cutoff}`;
  const itwCond = sql<boolean>`(${findings.pocLevel} = 'itw' OR COALESCE(${findings.tags}, '') ILIKE '%"kev"%' OR COALESCE(${findings.tags}, '') ILIKE '%"actively-exploited"%')`;

  const [{ mentions, itw }] = await db
    .select({
      mentions: sql<number>`count(*)`,
      itw: sql<number>`count(*) filter (where ${itwCond})`,
    })
    .from(findings)
    .where(and(isNotNull(findings.mitreIds), mitreCond, dateCond));

  return json({
    technique: tech
      ? {
          id: techniqueId,
          name: tech.name,
          description: tech.description ?? null,
          tactics: tacticMeta.tactics,
          tacticLabels: tacticMeta.tacticLabels,
        }
      : null,
    counts: { mentions: Number(mentions ?? 0), itw: Number(itw ?? 0), days },
    topActors,
    mitigations,
    d3fendTechniques,
    viaMitigations,
    links: { findings: `/findings?mitreId=${encodeURIComponent(techniqueId)}&days=${encodeURIComponent(String(days))}` },
  });
}

