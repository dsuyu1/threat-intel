export const runtime = "edge";

import { getDb } from "@ti/db";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";
import { computeComplianceFrameworkDashboard, isComplianceFramework, isSchemaOutOfDate } from "../../../../../lib/compliance";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ framework: string }> }) {
  const { framework } = await ctx.params;
  if (!isComplianceFramework(framework)) return json({ error: "Invalid framework" }, { status: 400 });

  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Compliance is available on Pro." }, { status: 403 });

  try {
    const dash = await computeComplianceFrameworkDashboard(db as any, { projectId: viewer.project.id, framework });
    return json({ ok: true, dashboard: dash });
  } catch (err) {
    if (isSchemaOutOfDate(err)) return json({ error: "Compliance tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
