export const runtime = "edge";

import {
  getDb,
  recomputeNavigatorScenariosForUser,
  getNavigatorConfigForProject,
  upsertNavigatorConfig,
} from "@ti/db";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const RISK_APPETITES = new Set(["conservative", "balanced", "aggressive"]);

export async function PATCH(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  if (!body) return json({ error: "Invalid JSON body" }, { status: 400 });

  const sector = body?.sector != null ? String(body.sector).trim() : null;
  const riskAppetite = body?.riskAppetite != null ? String(body.riskAppetite).trim() : null;
  const recompute = Boolean(body?.recompute);

  if (riskAppetite != null && !RISK_APPETITES.has(riskAppetite)) {
    return json({ error: "Invalid riskAppetite" }, { status: 400 });
  }
  if (sector != null && !sector) {
    return json({ error: "Invalid sector" }, { status: 400 });
  }

  const current = await getNavigatorConfigForProject({ db, projectId: ctx.project.id });

  const nextSector = sector ?? current.sector;
  const nextRiskAppetite = (riskAppetite ?? current.riskAppetite) as any;

  await upsertNavigatorConfig({
    db,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    config: {
      sector: nextSector,
      riskAppetite: nextRiskAppetite,
      crownJewels: current.crownJewels,
    },
  });

  const sectorChanged = nextSector !== current.sector;
  if (recompute || sectorChanged) {
    const result = await recomputeNavigatorScenariosForUser({
      db,
      projectId: ctx.project.id,
      userId: ctx.user.id,
      includeInferred: true,
    });
    return json({ ok: true, totalScenarios: result.total });
  }

  return json({ ok: true });
}
