export const runtime = "edge";

import {
  getDb,
  getNavigatorConfigForProject,
  kgEntities,
  recomputeNavigatorScenariosForUser,
  replaceUserStack,
  upsertNavigatorConfig,
  userStack,
} from "@ti/db";
import { asc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  const [config, stackRows, sectorRows] = await Promise.all([
    getNavigatorConfigForProject({ db, projectId: ctx.project.id }),
    db
      .select({ technology: userStack.technology, versionRange: userStack.versionRange })
      .from(userStack)
      .where(eq(userStack.projectId, ctx.project.id))
      .orderBy(asc(userStack.technology)),
    db
      .select({ id: kgEntities.entityId, name: kgEntities.name })
      .from(kgEntities)
      .where(eq(kgEntities.kind, "sector"))
      .orderBy(asc(kgEntities.name))
      .limit(200),
  ]);

  return json({
    user: ctx.user,
    team: ctx.team,
    project: ctx.project,
    access,
    config,
    stack: stackRows,
    sectorOptions: [{ id: "all", name: "All sectors" }, ...sectorRows],
  });
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const sector = String(body?.sector ?? "all");
  const riskAppetite = String(body?.riskAppetite ?? "balanced");
  const crownJewels = Array.isArray(body?.crownJewels) ? body.crownJewels : [];
  const stack = Array.isArray(body?.stack) ? body.stack : [];
  const includeInferred = Boolean(body?.includeInferred ?? true);

  await upsertNavigatorConfig({
    db,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    config: {
      sector,
      riskAppetite: riskAppetite as any,
      crownJewels,
    },
  });

  await replaceUserStack({
    db,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    items: stack,
  });

  const result = await recomputeNavigatorScenariosForUser({
    db,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    includeInferred,
  });

  return json({ ok: true, totalScenarios: result.total });
}
