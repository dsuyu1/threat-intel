export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, tabletopExercises } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { toIsoStringSafe } from "../../../../../lib/dates";
import { getViewerContext } from "../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

function badgeClass(status: string) {
  const s = String(status ?? "");
  if (s === "in_progress") return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  if (s === "completed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
  if (s === "scheduled") return "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20";
  return "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20";
}

export default async function TabletopListPage({ params }: { params: Promise<{ projectSlug: string }> }) {
  const p = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Tabletop exercises</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Tabletop exercises are available on Pro.</p>
      </div>
    );
  }

  let exercises: Array<any> = [];
  let schemaReady = true;
  try {
    exercises = await db
      .select({
        id: tabletopExercises.id,
        title: tabletopExercises.title,
        status: tabletopExercises.status,
        scenarioType: tabletopExercises.scenarioType,
        actorName: tabletopExercises.actorName,
        difficultyLevel: tabletopExercises.difficultyLevel,
        durationMinutes: tabletopExercises.durationMinutes,
        generatedAt: tabletopExercises.generatedAt,
        createdAt: tabletopExercises.createdAt,
      })
      .from(tabletopExercises)
      .where(eq(tabletopExercises.projectId, ctx.project.id))
      .orderBy(desc(tabletopExercises.createdAt))
      .limit(200);
  } catch (err) {
    if (isMissingTable(err)) schemaReady = false;
    else throw err;
  }

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Tabletop exercises</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Generate a complete tabletop package grounded in your Navigator gaps and run it in-platform.
          </p>
        </div>
        <Link
          href={`/p/${p.projectSlug}/tabletop/new`}
          className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95"
        >
          New exercise
        </Link>
      </header>

      {!schemaReady ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Tabletop tables are missing. Run <code className="font-mono">pnpm db:migrate</code>.
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Exercises</div>
          <div className="text-xs text-zinc-500 tabular-nums">{exercises.length}</div>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {schemaReady && exercises.length ? (
            exercises.map((e) => (
              <div key={e.id} className="px-5 py-4 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/p/${p.projectSlug}/tabletop/${e.id}`}
                    className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline truncate"
                  >
                    {e.title}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Actor: {e.actorName} • Scenario: {e.scenarioType} • Difficulty: {e.difficultyLevel} • Duration:{" "}
                    {e.durationMinutes}m
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${badgeClass(e.status)}`}>
                    {e.status}
                  </span>
                  <div className="text-[11px] text-zinc-500 tabular-nums">{toIsoStringSafe(e.createdAt)}</div>
                </div>
              </div>
            ))
          ) : schemaReady ? (
            <div className="px-5 py-8 text-sm text-zinc-600 dark:text-zinc-400">No exercises yet. Create one.</div>
          ) : (
            <div className="px-5 py-8 text-sm text-zinc-600 dark:text-zinc-400">Schema not ready.</div>
          )}
        </div>
      </div>
    </div>
  );
}
