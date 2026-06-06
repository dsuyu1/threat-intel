export const runtime = "edge";

import type { NextRequest } from "next/server";
import { getDb, kgEntities, kgRelations, navigatorScenarios } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const { id } = await ctx.params;
  const [s] = await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      actorId: navigatorScenarios.actorId,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, id), eq(navigatorScenarios.projectId, viewer.project.id)))
    .limit(1);

  if (!s) return json({ error: "Not found" }, { status: 404 });

  const techEnt = alias(kgEntities, "tech_ent");
  const topTech = await db
    .select({ id: kgRelations.toId, name: techEnt.name })
    .from(kgRelations)
    .innerJoin(techEnt, and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId)))
    .where(
      and(
        eq(kgRelations.type, "actor_uses_technique"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "technique"),
        eq(kgRelations.fromId, s.actorId)
      )
    )
    .orderBy(desc(sql`${kgRelations.support} * ${kgRelations.confidence}`))
    .limit(30);

  const techniqueIds = new Set<string>(topTech.map((t) => t.id));
  if (s.targetKind === "technique") techniqueIds.add(s.targetId);

  const primary = s.targetKind === "technique" ? s.targetId : null;

  const techniques = Array.from(techniqueIds).map((techniqueID) => ({
    techniqueID,
    score: primary === techniqueID ? 100 : 50,
    enabled: true,
    comment: primary === techniqueID ? "Scenario focus" : "Observed in actor journey map",
  }));

  const layer = {
    name: s.title,
    description: s.summary ?? "",
    domain: "enterprise-attack",
    version: "4.5",
    techniques,
    gradient: {
      colors: ["#1e3a8a", "#60a5fa", "#fef3c7", "#f97316"],
      minValue: 0,
      maxValue: 100,
    },
    legendItems: [
      { label: "Scenario focus", color: "#f97316" },
      { label: "Actor journey map", color: "#60a5fa" },
    ],
    metadata: [
      { name: "generator", value: "Threat Actor Navigator (CTEM v1)" },
      { name: "scenarioId", value: s.id },
    ],
  };

  return json(layer, {
    headers: {
      "content-disposition": `attachment; filename=\"navigator-layer-${s.id}.json\"`,
    },
  });
}
