export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, tabletopExercises, tabletopSessions } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../../lib/tenancy";
import { TabletopFacilitatorConsole } from "../../../../../../../components/tabletop/TabletopFacilitatorConsole";

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

export default async function TabletopSessionConsolePage({
  params,
}: {
  params: Promise<{ projectSlug: string; exerciseId: string }>;
}) {
  const p = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Facilitator console</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Tabletop exercises are available on Pro.</p>
      </div>
    );
  }

  try {
    const [exercise] = await db
      .select({ id: tabletopExercises.id, title: tabletopExercises.title, projectId: tabletopExercises.projectId })
      .from(tabletopExercises)
      .where(and(eq(tabletopExercises.id, p.exerciseId), eq(tabletopExercises.projectId, ctx.project.id)))
      .limit(1);
    if (!exercise) {
      return (
        <div className="mx-auto max-w-[1600px] px-8 py-10">
          <Link
            href={`/p/${p.projectSlug}/tabletop`}
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
          >
            ← Back to tabletop
          </Link>
          <div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Not found.</div>
        </div>
      );
    }

    const [latestSession] = await db
      .select({
        id: tabletopSessions.id,
        status: tabletopSessions.status,
        currentSequence: tabletopSessions.currentSequence,
        facilitatorUserId: tabletopSessions.facilitatorUserId,
        startedAt: tabletopSessions.startedAt,
        endedAt: tabletopSessions.endedAt,
      })
      .from(tabletopSessions)
      .where(eq(tabletopSessions.exerciseId, exercise.id))
      .orderBy(desc(tabletopSessions.createdAt))
      .limit(1);

    return (
      <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-6">
        <header className="space-y-2">
          <Link
            href={`/p/${p.projectSlug}/tabletop/${encodeURIComponent(exercise.id)}`}
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
          >
            ← Back to exercise
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Facilitator console</h1>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">{exercise.title}</div>
        </header>

        <TabletopFacilitatorConsole
          projectSlug={p.projectSlug}
          exerciseId={exercise.id}
          initialSession={
            latestSession
              ? {
                  id: latestSession.id,
                  status: latestSession.status as any,
                  currentSequence: Number(latestSession.currentSequence ?? 0),
                  facilitatorUserId: latestSession.facilitatorUserId,
                  startedAt: latestSession.startedAt ? String(latestSession.startedAt) : null,
                  endedAt: latestSession.endedAt ? String(latestSession.endedAt) : null,
                }
              : null
          }
        />
      </div>
    );
  } catch (err) {
    if (isMissingTable(err)) {
      return (
        <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-3">
          <Link href={`/p/${p.projectSlug}/tabletop`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Back to tabletop
          </Link>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Tabletop tables are missing. Run <code className="font-mono">pnpm db:migrate</code>.
          </div>
        </div>
      );
    }
    throw err;
  }
}
