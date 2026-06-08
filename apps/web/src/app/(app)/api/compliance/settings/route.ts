export const runtime = "edge";

import { getDb } from "@ti/db";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";
import { COMPLIANCE_FRAMEWORKS, isComplianceFramework, isSchemaOutOfDate, setComplianceSettings } from "../../../../../lib/compliance";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Compliance is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const federalFunding = Boolean(body?.federalFunding);
  const cyberInsurance = Boolean(body?.cyberInsurance);

  const enabledFrameworksRaw = Array.isArray(body?.enabledFrameworks) ? (body.enabledFrameworks as unknown[]) : [];
  const enabledFrameworks = enabledFrameworksRaw
    .map((f) => String(f ?? "").trim())
    .filter((f): f is any => isComplianceFramework(f));

  // Ensure stable order and no duplicates
  const enabled = COMPLIANCE_FRAMEWORKS.filter((f) => enabledFrameworks.includes(f));

  try {
    await setComplianceSettings(db as any, {
      projectId: viewer.project.id,
      federalFunding,
      cyberInsurance,
      enabledFrameworks: enabled,
    });
    return json({ ok: true, enabledFrameworks: enabled });
  } catch (err) {
    if (isSchemaOutOfDate(err)) return json({ error: "Compliance tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
