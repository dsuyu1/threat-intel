export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, navigatorScenarios, projects } from "@ti/db";
import { getViewerContext } from "../../../lib/tenancy";

export default async function RiskEntryRedirect({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  const db = getDb();
  const ctx = await getViewerContext();

  const [row] = await db
    .select({ slug: projects.slug })
    .from(navigatorScenarios)
    .innerJoin(projects, eq(projects.id, navigatorScenarios.projectId))
    .where(and(eq(navigatorScenarios.id, scenarioId), eq(projects.teamId, ctx.team.id)))
    .limit(1);

  const projectSlug = row?.slug ?? ctx.project.slug;
  redirect(`/p/${projectSlug}/risk/${scenarioId}`);
}

