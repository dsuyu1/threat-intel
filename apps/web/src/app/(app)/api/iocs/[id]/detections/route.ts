export const runtime = "edge";

import {
  getDb,
  iocSources,
  iocs,
  kgEntities,
  kgRelations,
  navigatorDetectionJobs,
  navigatorScenarios,
} from "@ti/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  const msg = String(anyErr?.message ?? "");
  if (code === "42P01" || code === "42703" || msg.includes("does not exist")) return true;
  // Migration not applied (enum value missing).
  if (/invalid input value for enum/i.test(msg) && msg.includes("navigator_scenario_type") && msg.includes("\"ioc\"")) return true;
  return false;
}

type DetectionFormat = "sigma" | "kql" | "spl";
const FORMATS: DetectionFormat[] = ["sigma", "kql", "spl"];

function normalizeFormats(input: unknown): DetectionFormat[] {
  const arr = Array.isArray(input) ? input : null;
  if (!arr) return [...FORMATS];
  const out: DetectionFormat[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!(FORMATS as readonly string[]).includes(s)) continue;
    if (!out.includes(s as DetectionFormat)) out.push(s as DetectionFormat);
  }
  return out.length ? out : [...FORMATS];
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function scenarioKeyForIocTechnique(params: {
  projectId: string;
  iocId: string;
  techniqueId: string;
}) {
  return [`p:${params.projectId}`, "t:ioc", `ioc:${params.iocId}`, "k:technique", `id:${params.techniqueId}`].join("|");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const { id } = await ctx.params;
  const projectSlug = req.headers.get("x-ti-project-slug");
  let viewer: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    viewer = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const requestedTechniqueId = body?.techniqueId != null ? String(body.techniqueId).trim() : "";
  const formats = normalizeFormats(body?.formats);

  try {
    const [ioc] = await db
      .select({
        id: iocs.id,
        projectId: iocs.projectId,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
      })
      .from(iocs)
      .where(and(eq(iocs.projectId, viewer.project.id), eq(iocs.id, id)))
      .limit(1);

    if (!ioc) return json({ error: "IOC not found" }, { status: 404 });

    const techEnt = alias(kgEntities, "tech_ent");
    const actorEnt = alias(kgEntities, "actor_ent");
    const strength = sql<number>`${kgRelations.support} * ${kgRelations.confidence}`;

    const relatedTechniques = await db
      .select({
        techniqueId: kgRelations.toId,
        techniqueName: techEnt.name,
        strength,
        lastSeen: kgRelations.lastSeen,
      })
      .from(kgRelations)
      .leftJoin(techEnt, and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId)))
      .where(
        and(
          eq(kgRelations.type, "ioc_indicates_technique"),
          eq(kgRelations.fromKind, "ioc"),
          eq(kgRelations.fromId, ioc.id),
          eq(kgRelations.toKind, "technique")
        )
      )
      .orderBy(desc(strength), desc(kgRelations.lastSeen))
      .limit(20);

    const relatedActors = await db
      .select({
        actorId: kgRelations.toId,
        actorName: actorEnt.name,
        strength,
        lastSeen: kgRelations.lastSeen,
      })
      .from(kgRelations)
      .leftJoin(actorEnt, and(eq(actorEnt.kind, "actor"), eq(actorEnt.entityId, kgRelations.toId)))
      .where(
        and(
          eq(kgRelations.type, "ioc_indicates_actor"),
          eq(kgRelations.fromKind, "ioc"),
          eq(kgRelations.fromId, ioc.id),
          eq(kgRelations.toKind, "actor")
        )
      )
      .orderBy(desc(strength), desc(kgRelations.lastSeen))
      .limit(10);

    const techniqueId = requestedTechniqueId || (relatedTechniques[0]?.techniqueId ? String(relatedTechniques[0].techniqueId) : "");
    if (!techniqueId) {
      return json(
        {
          error:
            "No techniques are mapped to this IOC yet. " +
            "Run the TAXII import with relationship objects (indicator indicates attack-pattern) and try again.",
        },
        { status: 409 }
      );
    }

    const techniqueName =
      relatedTechniques.find((t) => String(t.techniqueId) === techniqueId)?.techniqueName ??
      (await (async () => {
        const [row] = await db
          .select({ name: kgEntities.name })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "technique"), eq(kgEntities.entityId, techniqueId)))
          .limit(1);
        return row?.name ?? null;
      })());

    const topActor = relatedActors[0];
    const actorId = topActor?.actorId ? String(topActor.actorId) : `U-IOC-${ioc.id}`;
    const actorName = topActor?.actorName ? String(topActor.actorName) : "IOC-derived signal";

    const now = new Date();

    const sourceRows = await db
      .select({
        externalId: iocSources.externalId,
        externalUrl: iocSources.externalUrl,
        confidence: iocSources.confidence,
        lastSeenAt: iocSources.lastSeenAt,
      })
      .from(iocSources)
      .where(and(eq(iocSources.projectId, viewer.project.id), eq(iocSources.iocId, ioc.id)))
      .orderBy(desc(iocSources.lastSeenAt), desc(iocSources.createdAt))
      .limit(20);

    const evidenceItems = sourceRows
      .map((s) => {
        const url = s.externalUrl ? String(s.externalUrl).trim() : "";
        if (!url) return null;
        const conf = typeof s.confidence === "number" ? clamp01(s.confidence / 100) : 0.6;
        const excerpt = `IOC ${ioc.kind}:${ioc.value} observed in TAXII indicator ${String(s.externalId)}`.slice(0, 600);
        return { url, excerpt, confidence: conf };
      })
      .filter(Boolean)
      .slice(0, 4) as Array<{ url: string; excerpt: string; confidence: number }>;

    const scenarioKey = scenarioKeyForIocTechnique({ projectId: viewer.project.id, iocId: ioc.id, techniqueId });

    const title = `${ioc.kind.toUpperCase()}: ${ioc.value} → ${techniqueName ?? techniqueId}`;
    const summary =
      `Auto-generated from IOC-to-TTP mappings (TAXII). ` +
      `IOC ${ioc.kind}:${ioc.value} indicates ${techniqueName ?? techniqueId}.`;

    const [scenario] = await db
      .insert(navigatorScenarios)
      .values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        scenarioKey,
        scenarioType: "ioc",
        actorId,
        actorName,
        targetKind: "technique",
        targetId: techniqueId,
        targetName: techniqueName ?? techniqueId,
        title,
        summary,
        evidenceJson: { items: evidenceItems } as never,
        attributes: { createdFrom: "ioc", iocId: ioc.id, iocKind: ioc.kind, iocValue: ioc.value } as never,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [navigatorScenarios.projectId, navigatorScenarios.scenarioKey],
        set: {
          userId: viewer.user.id,
          actorName,
          targetName: techniqueName ?? techniqueId,
          title,
          summary,
          evidenceJson: sql`excluded.evidence_json`,
          attributes: sql`excluded.attributes`,
          computedAt: now,
        },
      })
      .returning({ id: navigatorScenarios.id });

    const scenarioId = scenario?.id ? String(scenario.id) : null;
    if (!scenarioId) return json({ error: "Failed to create scenario" }, { status: 500 });

    const [existingJob] = await db
      .select({ status: navigatorDetectionJobs.status })
      .from(navigatorDetectionJobs)
      .where(
        and(
          eq(navigatorDetectionJobs.projectId, viewer.project.id),
          eq(navigatorDetectionJobs.scenarioId, scenarioId),
          eq(navigatorDetectionJobs.techniqueId, techniqueId),
          inArray(navigatorDetectionJobs.status, ["queued", "running"])
        )
      )
      .limit(1);

    if (!existingJob) {
      await db.insert(navigatorDetectionJobs).values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        scenarioId,
        techniqueId,
        formats,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      });
    }

    return json({
      ok: true,
      queued: !existingJob,
      formats,
      scenarioId,
      technique: { id: techniqueId, name: techniqueName ?? techniqueId },
      actor: { id: actorId, name: actorName },
      related: {
        actors: relatedActors.map((a) => ({ id: String(a.actorId), name: a.actorName ? String(a.actorName) : null })),
        techniques: relatedTechniques.map((t) => ({
          id: String(t.techniqueId),
          name: t.techniqueName ? String(t.techniqueName) : null,
        })),
      },
    });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Navigator/IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
