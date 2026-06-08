export const runtime = "edge";

import { getDb } from "@ti/db";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";
import { COMPLIANCE_FRAMEWORKS, computeComplianceFrameworkDashboard, frameworkLabel, getComplianceSettings, isSchemaOutOfDate } from "../../../../../lib/compliance";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Compliance is available on Pro." }, { status: 403 });

  const settings = await getComplianceSettings(db as any, viewer.project.id);
  const enabledSet = new Set(settings.enabled);

  const summaries: Array<any> = [];
  for (const fw of COMPLIANCE_FRAMEWORKS) {
    if (!enabledSet.has(fw)) {
      summaries.push({ framework: fw, label: frameworkLabel(fw), enabled: false });
      continue;
    }
    try {
      const dash = await computeComplianceFrameworkDashboard(db as any, { projectId: viewer.project.id, framework: fw });
      summaries.push({
        framework: fw,
        label: dash.label,
        enabled: true,
        hasControlCatalog: dash.hasControlCatalog,
        controlsTotal: dash.controlsTotal,
        coveredCount: dash.coveredCount,
        partialCount: dash.partialCount,
        gapCount: dash.gapCount,
        coveragePct: dash.coveragePct,
      });
    } catch (err) {
      if (isSchemaOutOfDate(err)) return json({ error: "Compliance tables are missing. Run pnpm db:migrate." }, { status: 503 });
      throw err;
    }
  }

  return json({
    ok: true,
    schemaReady: settings.schemaReady,
    settings: settings.settings,
    enabledFrameworks: settings.enabled,
    frameworks: summaries,
  });
}
