export const runtime = "edge";

import { getDb, riskToleranceProfiles } from "@ti/db";
import { eq, sql } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const DEFAULTS = {
  operational: 60,
  financial: 60,
  compliance: 50,
  reputational: 50,
};

function toThreshold(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function PATCH(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Risk management is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;

  const now = new Date();
  const operational = toThreshold(body?.operational, DEFAULTS.operational);
  const financial = toThreshold(body?.financial, DEFAULTS.financial);
  const compliance = toThreshold(body?.compliance, DEFAULTS.compliance);
  const reputational = toThreshold(body?.reputational, DEFAULTS.reputational);

  try {
    await db
      .insert(riskToleranceProfiles)
      .values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        operationalThreshold: operational,
        financialThreshold: financial,
        complianceThreshold: compliance,
        reputationalThreshold: reputational,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [riskToleranceProfiles.projectId],
        set: {
          operationalThreshold: sql`excluded.operational_threshold`,
          financialThreshold: sql`excluded.financial_threshold`,
          complianceThreshold: sql`excluded.compliance_threshold`,
          reputationalThreshold: sql`excluded.reputational_threshold`,
          updatedAt: now,
        },
      });

    const [row] = await db
      .select({
        operational: riskToleranceProfiles.operationalThreshold,
        financial: riskToleranceProfiles.financialThreshold,
        compliance: riskToleranceProfiles.complianceThreshold,
        reputational: riskToleranceProfiles.reputationalThreshold,
        updatedAt: riskToleranceProfiles.updatedAt,
      })
      .from(riskToleranceProfiles)
      .where(eq(riskToleranceProfiles.projectId, viewer.project.id))
      .limit(1);

    return json({ ok: true, profile: row ?? DEFAULTS });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Risk tolerance tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
