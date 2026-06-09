export const runtime = "edge";
export const dynamic = "force-dynamic";

import {
  getDb,
  navigatorScenarios,
  projects,
  riskEntries,
  riskToleranceProfiles,
  teams,
} from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { isSuperAdmin } from "../../../../lib/admin";
import { getViewerContext } from "../../../../lib/tenancy";

function nf(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function monthKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default async function MsspAdminPage() {
  const viewer = await getViewerContext();
  if (!isSuperAdmin(viewer)) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Not found</h1>
      </div>
    );
  }

  const db = getDb();

  const projectRows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      clerkOrgId: teams.clerkOrgId,
      projectId: projects.id,
      projectSlug: projects.slug,
      projectName: projects.name,
      projectCreatedAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .orderBy(asc(teams.name), asc(projects.name))
    .limit(5000);

  const projectIds = projectRows.map((p) => p.projectId);

  const unvalidatedByProject = new Map<string, number>();
  if (projectIds.length) {
    const rows = await db
      .select({
        projectId: navigatorScenarios.projectId,
        total: sql<number>`count(*)`,
      })
      .from(navigatorScenarios)
      .where(
        and(
          inArray(navigatorScenarios.projectId, projectIds),
          inArray(navigatorScenarios.validationStatus, ["unvalidated" as any, "in_progress" as any])
        )
      )
      .groupBy(navigatorScenarios.projectId)
      .limit(50_000);
    for (const r of rows) unvalidatedByProject.set(String(r.projectId), Number(r.total ?? 0));
  }

  const riskByProject = new Map<
    string,
    { openCount: number; overToleranceCount: number; openScoreSum: number }
  >();

  if (projectIds.length) {
    try {
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

      const rows = await db
        .select({
          projectId: riskEntries.projectId,
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
        .where(inArray(riskEntries.projectId, projectIds))
        .groupBy(riskEntries.projectId)
        .limit(50_000);

      for (const r of rows) {
        riskByProject.set(String(r.projectId), {
          openCount: Number(r.openCount ?? 0),
          overToleranceCount: Number(r.overToleranceCount ?? 0),
          openScoreSum: Number(r.openScoreSum ?? 0),
        });
      }
    } catch {
      // Risk tables are optional in some deployments.
    }
  }

  const teamsById = new Map<
    string,
    {
      teamId: string;
      teamName: string;
      clerkOrgId: string;
      projects: Array<{ id: string; slug: string; name: string; createdAt: Date }>;
      unvalidated: number;
      openRisks: number;
      overTolerance: number;
      openScoreSum: number;
    }
  >();

  for (const p of projectRows) {
    const teamId = String(p.teamId);
    let entry = teamsById.get(teamId);
    if (!entry) {
      entry = {
        teamId,
        teamName: String(p.teamName),
        clerkOrgId: String(p.clerkOrgId),
        projects: [],
        unvalidated: 0,
        openRisks: 0,
        overTolerance: 0,
        openScoreSum: 0,
      };
      teamsById.set(teamId, entry);
    }

    entry.projects.push({
      id: String(p.projectId),
      slug: String(p.projectSlug),
      name: String(p.projectName),
      createdAt: p.projectCreatedAt as any,
    });

    entry.unvalidated += unvalidatedByProject.get(String(p.projectId)) ?? 0;
    const risk = riskByProject.get(String(p.projectId)) ?? { openCount: 0, overToleranceCount: 0, openScoreSum: 0 };
    entry.openRisks += risk.openCount;
    entry.overTolerance += risk.overToleranceCount;
    entry.openScoreSum += risk.openScoreSum;

    teamsById.set(teamId, entry);
  }

  const month = monthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)));
  const teamsList = Array.from(teamsById.values()).sort(
    (a, b) =>
      b.overTolerance - a.overTolerance ||
      b.openRisks - a.openRisks ||
      b.unvalidated - a.unvalidated ||
      a.teamName.localeCompare(b.teamName)
  );

  return (
      <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">MSSP dashboard</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Super-admin view across all client teams and projects.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Clients"
          description="Aggregated posture per client (team)."
          right={
            <div className="text-xs text-zinc-500">
              Monthly reports: <span className="font-mono">{month}</span>
            </div>
          }
        />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="text-left font-medium py-2 pr-4">Client</th>
                  <th className="text-right font-medium py-2 pr-4">Projects</th>
                  <th className="text-right font-medium py-2 pr-4">Unvalidated</th>
                  <th className="text-right font-medium py-2 pr-4">Open risk</th>
                  <th className="text-right font-medium py-2 pr-4">Over tolerance</th>
                  <th className="text-right font-medium py-2 pr-4">Risk score</th>
                  <th className="text-left font-medium py-2 pr-4">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                {teamsList.map((t) => (
                  <tr key={t.teamId} className="align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{t.teamName}</div>
                      <div className="text-xs text-zinc-500 font-mono truncate max-w-[520px]">{t.clerkOrgId}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {t.projects.slice(0, 6).map((p) => (
                          <span
                            key={p.id}
                            className="text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            {p.name}
                          </span>
                        ))}
                        {t.projects.length > 6 ? (
                          <span className="text-xs text-zinc-500">+{t.projects.length - 6} more</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{nf(t.projects.length)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{nf(t.unvalidated)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{nf(t.openRisks)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{nf(t.overTolerance)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{nf(t.openScoreSum)}</td>
                    <td className="py-3 pr-4">
                      <a
                        href={`/admin/mssp/report?teamId=${encodeURIComponent(t.teamId)}&month=${encodeURIComponent(
                          month
                        )}`}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Download CSV
                      </a>
                    </td>
                  </tr>
                ))}
                {!teamsList.length ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-sm text-zinc-600 dark:text-zinc-400">
                      No projects found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-zinc-500">
        Access is gated by <code>TI_SUPERADMIN_CLERK_IDS</code> / <code>TI_SUPERADMIN_USER_IDS</code>.
      </div>
    </div>
  );
}
