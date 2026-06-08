export const runtime = "edge";

import { getDb, recomputeNavigatorScenariosForUser } from "@ti/db";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const includeInferred = Boolean(body?.includeInferred ?? true);

  const result = await recomputeNavigatorScenariosForUser({
    db,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    includeInferred,
  });

  return json({ ok: true, totalScenarios: result.total });
}
