export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, navigatorScenarios, riskEntries, riskToleranceProfiles } from "@ti/db";
import { and, eq, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../../lib/api-auth";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "risk:read" });
  if (!auth.ok) return auth.res;

  const projectId = auth.apiKey.projectId;

  const db = getDb();

  // Use the project’s configured tolerance profile when available; fall back to defaults.
  const operationalThreshold = sql<number>`coalesce(${riskToleranceProfiles.operationalThreshold}, 60)`;
  const financialThreshold = sql<number>`coalesce(${riskToleranceProfiles.financialThreshold}, 60)`;
  const complianceThreshold = sql<number>`coalesce(${riskToleranceProfiles.complianceThreshold}, 50)`;
  const reputationalThreshold = sql<number>`coalesce(${riskToleranceProfiles.reputationalThreshold}, 50)`;

  const thresholdByCategory = sql<number>`case ${riskEntries.category}
    when 'financial' then ${financialThreshold}
    when 'compliance' then ${complianceThreshold}
    when 'reputational' then ${reputationalThreshold}
    else ${operationalThreshold}
  end`;

  const closedAtEffective = sql<Date | null>`coalesce(${riskEntries.closedAt}, case when ${riskEntries.status} = 'closed' then ${riskEntries.updatedAt} else null end)`;
  const isOpen = sql<boolean>`(${closedAtEffective} is null and ${riskEntries.status} != 'closed')`;

  const [row] = await db
    .select({
      openCount: sql<number>`sum(case when ${isOpen} then 1 else 0 end)`,
      overToleranceCount: sql<number>`sum(case when ${isOpen} and ${navigatorScenarios.score} >= ${thresholdByCategory} then 1 else 0 end)`,
      openScoreSum: sql<number>`sum(case when ${isOpen} then ${navigatorScenarios.score} else 0 end)`,
    })
    .from(riskEntries)
    .innerJoin(
      navigatorScenarios,
      and(eq(navigatorScenarios.id, riskEntries.scenarioId), eq(navigatorScenarios.projectId, riskEntries.projectId))
    )
    .leftJoin(riskToleranceProfiles, eq(riskToleranceProfiles.projectId, riskEntries.projectId))
    .where(eq(riskEntries.projectId, projectId))
    .limit(1);

  return json({
    ok: true,
    projectId,
    risk: {
      openCount: Number(row?.openCount ?? 0),
      overToleranceCount: Number(row?.overToleranceCount ?? 0),
      openScoreSum: Number(row?.openScoreSum ?? 0),
    },
  });
}
