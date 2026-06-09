export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, navigatorActions, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { NavigatorActionsTable } from "../../../../../../components/navigator/NavigatorActionsTable";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

export default async function NavigatorActionsPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Action tracker</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Navigator is available on Pro.</p>
      </div>
    );
  }

  const actions = await db
    .select({
      id: navigatorActions.id,
      title: navigatorActions.title,
      status: navigatorActions.status,
      slaTier: navigatorActions.slaTier,
      dueDate: navigatorActions.dueDate,
      scenarioId: navigatorActions.scenarioId,
      scenarioTitle: navigatorScenarios.title,
      scenarioScore: navigatorScenarios.score,
    })
    .from(navigatorActions)
    .innerJoin(navigatorScenarios, eq(navigatorScenarios.id, navigatorActions.scenarioId))
    .where(and(eq(navigatorActions.projectId, ctx.project.id), eq(navigatorScenarios.projectId, ctx.project.id)))
    .orderBy(asc(navigatorActions.status), desc(navigatorScenarios.score), asc(navigatorActions.dueDate));

  return (
    <div className="max-w-[1600px] mx-auto px-8 py-10">
      <a
        href={`/p/${p.projectSlug}/navigator`}
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
      >
        ← Back to Navigator
      </a>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Action tracker</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Lightweight tracking for validation and remediation work.
      </p>
      <NavigatorActionsTable projectSlug={p.projectSlug} initialActions={actions as any} />
    </div>
  );
}
