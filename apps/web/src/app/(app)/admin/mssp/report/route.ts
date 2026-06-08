export const runtime = "edge";
export const dynamic = "force-dynamic";

import {
  getDb,
  navigatorScenarios,
  projects,
  riskEntries,
  riskToleranceProfiles,
  sboms,
  teams,
} from "@ti/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isSuperAdmin } from "../../../../../lib/admin";
import { getViewerContext } from "../../../../../lib/tenancy";

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function textResponse(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function parseMonth(value: string | null) {
  const v = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  const [y, m] = v.split("-").map((x) => Number(x));
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return { key: v, start, end };
}

export async function GET(req: Request) {
  const viewer = await getViewerContext();
  if (!isSuperAdmin(viewer)) return textResponse("Not found", 404);

  const u = new URL(req.url);
  const teamId = u.searchParams.get("teamId");
  const month = parseMonth(u.searchParams.get("month"));
  if (!teamId) return textResponse("teamId is required");
  if (!month) return textResponse("month must be YYYY-MM");

  const db = getDb();

  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return textResponse("Team not found", 404);

  const projRows = await db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.name))
    .limit(2000);

  const projectIds = projRows.map((p) => p.id);

  const scenariosByProject = new Map<
    string,
    { total: number; unvalidated: number; validated: number }
  >();
  if (projectIds.length) {
    const rows = await db
      .select({
        projectId: navigatorScenarios.projectId,
        total: sql<number>`count(*)`,
        unvalidated: sql<number>`sum(case when ${navigatorScenarios.validationStatus} in ('unvalidated','in_progress') then 1 else 0 end)`,
        validated: sql<number>`sum(case when ${navigatorScenarios.validationStatus} = 'validated' then 1 else 0 end)`,
      })
      .from(navigatorScenarios)
      .where(inArray(navigatorScenarios.projectId, projectIds))
      .groupBy(navigatorScenarios.projectId)
      .limit(50_000);
    for (const r of rows) {
      scenariosByProject.set(String(r.projectId), {
        total: Number(r.total ?? 0),
        unvalidated: Number(r.unvalidated ?? 0),
        validated: Number(r.validated ?? 0),
      });
    }
  }

  const riskByProject = new Map<
    string,
    { newCount: number; closedCount: number; openAtEnd: number; overToleranceAtEnd: number; scoreAtEnd: number }
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
      const openAtEnd = sql<boolean>`(${riskEntries.createdAt} < ${month.end} and (${closedAtEffective} is null or ${closedAtEffective} >= ${month.end}))`;

      const rows = await db
        .select({
          projectId: riskEntries.projectId,
          newCount: sql<number>`sum(case when ${riskEntries.createdAt} >= ${month.start} and ${riskEntries.createdAt} < ${month.end} then 1 else 0 end)`,
          closedCount: sql<number>`sum(case when ${closedAtEffective} >= ${month.start} and ${closedAtEffective} < ${month.end} then 1 else 0 end)`,
          openAtEnd: sql<number>`sum(case when ${openAtEnd} then 1 else 0 end)`,
          overToleranceAtEnd: sql<number>`sum(case when ${openAtEnd} and ${navigatorScenarios.score} >= ${thresholdByCategory} then 1 else 0 end)`,
          scoreAtEnd: sql<number>`sum(case when ${openAtEnd} then ${navigatorScenarios.score} else 0 end)`,
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
          newCount: Number(r.newCount ?? 0),
          closedCount: Number(r.closedCount ?? 0),
          openAtEnd: Number(r.openAtEnd ?? 0),
          overToleranceAtEnd: Number(r.overToleranceAtEnd ?? 0),
          scoreAtEnd: Number(r.scoreAtEnd ?? 0),
        });
      }
    } catch {
      // Risk schema may be missing.
    }
  }

  const sbomByProject = new Map<string, { uploadsInMonth: number; bestActiveCves: number }>();
  if (projectIds.length) {
    try {
      const rows = await db
        .select({
          projectId: sboms.projectId,
          uploadsInMonth: sql<number>`sum(case when ${sboms.createdAt} >= ${month.start} and ${sboms.createdAt} < ${month.end} then 1 else 0 end)`,
          bestActiveCves: sql<number>`max(${sboms.matchedCveCount})`,
        })
        .from(sboms)
        .where(inArray(sboms.projectId, projectIds))
        .groupBy(sboms.projectId)
        .limit(50_000);
      for (const r of rows) {
        sbomByProject.set(String(r.projectId), {
          uploadsInMonth: Number(r.uploadsInMonth ?? 0),
          bestActiveCves: Number(r.bestActiveCves ?? 0),
        });
      }
    } catch {
      // SBOM schema may be missing.
    }
  }

  const header = [
    "team_id",
    "team_name",
    "month",
    "project_id",
    "project_slug",
    "project_name",
    "scenarios_total",
    "scenarios_unvalidated",
    "scenarios_validated",
    "risk_new",
    "risk_closed",
    "risk_open_end",
    "risk_over_tolerance_end",
    "risk_score_end",
    "sbom_uploads_month",
    "sbom_active_cves_max",
  ];

  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));

  let totals = {
    scenariosTotal: 0,
    scenariosUnvalidated: 0,
    scenariosValidated: 0,
    riskNew: 0,
    riskClosed: 0,
    riskOpenEnd: 0,
    riskOverTolEnd: 0,
    riskScoreEnd: 0,
    sbomUploads: 0,
  };

  for (const p of projRows) {
    const scen = scenariosByProject.get(p.id) ?? { total: 0, unvalidated: 0, validated: 0 };
    const risk = riskByProject.get(p.id) ?? { newCount: 0, closedCount: 0, openAtEnd: 0, overToleranceAtEnd: 0, scoreAtEnd: 0 };
    const sb = sbomByProject.get(p.id) ?? { uploadsInMonth: 0, bestActiveCves: 0 };

    totals.scenariosTotal += scen.total;
    totals.scenariosUnvalidated += scen.unvalidated;
    totals.scenariosValidated += scen.validated;
    totals.riskNew += risk.newCount;
    totals.riskClosed += risk.closedCount;
    totals.riskOpenEnd += risk.openAtEnd;
    totals.riskOverTolEnd += risk.overToleranceAtEnd;
    totals.riskScoreEnd += risk.scoreAtEnd;
    totals.sbomUploads += sb.uploadsInMonth;

    lines.push(
      [
        team.id,
        team.name,
        month.key,
        p.id,
        p.slug,
        p.name,
        scen.total,
        scen.unvalidated,
        scen.validated,
        risk.newCount,
        risk.closedCount,
        risk.openAtEnd,
        risk.overToleranceAtEnd,
        risk.scoreAtEnd,
        sb.uploadsInMonth,
        sb.bestActiveCves,
      ].map(csvEscape).join(",")
    );
  }

  lines.push(
    [
      team.id,
      team.name,
      month.key,
      "",
      "",
      "TOTAL",
      totals.scenariosTotal,
      totals.scenariosUnvalidated,
      totals.scenariosValidated,
      totals.riskNew,
      totals.riskClosed,
      totals.riskOpenEnd,
      totals.riskOverTolEnd,
      totals.riskScoreEnd,
      totals.sbomUploads,
      "",
    ].map(csvEscape).join(",")
  );

  const filename = `mssp-report-${team.name}-${month.key}.csv`.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
