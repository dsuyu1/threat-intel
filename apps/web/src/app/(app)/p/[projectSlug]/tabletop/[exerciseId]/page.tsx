export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, tabletopExercises, tabletopInjects, tabletopRoles } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

export default async function TabletopExercisePage({
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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Tabletop exercise</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Tabletop exercises are available on Pro.</p>
      </div>
    );
  }

  try {
    const [exercise] = await db
      .select()
      .from(tabletopExercises)
      .where(and(eq(tabletopExercises.id, p.exerciseId), eq(tabletopExercises.projectId, ctx.project.id)))
      .limit(1);
    if (!exercise) {
      return (
      <div className="mx-auto max-w-[1600px] px-8 py-10">
        <Link href={`/p/${p.projectSlug}/tabletop`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to tabletop
        </Link>
        <div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Not found.</div>
      </div>
    );
  }

    const injects = await db
      .select()
      .from(tabletopInjects)
      .where(eq(tabletopInjects.exerciseId, exercise.id))
      .orderBy(asc(tabletopInjects.sequence))
      .limit(50);

    const roles = await db
      .select()
      .from(tabletopRoles)
      .where(eq(tabletopRoles.exerciseId, exercise.id))
      .orderBy(asc(tabletopRoles.roleName))
      .limit(50);

    return (
      <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-8">
        <header className="space-y-3">
          <Link href={`/p/${p.projectSlug}/tabletop`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Back to tabletop
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 truncate">{exercise.title}</h1>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Actor: {exercise.actorName} • Scenario: {exercise.scenarioType} • Difficulty: {exercise.difficultyLevel} • Duration:{" "}
                {exercise.durationMinutes}m
                {exercise.complianceTag ? ` • Compliance: ${exercise.complianceTag}` : ""}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <a
                href={`/api/tabletop/exercises/${encodeURIComponent(exercise.id)}/export/docx`}
                className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
              >
                DOCX
              </a>
              <a
                href={`/api/tabletop/exercises/${encodeURIComponent(exercise.id)}/export/pptx`}
                className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
              >
                PPTX
              </a>
              <a
                href={`/api/tabletop/exercises/${encodeURIComponent(exercise.id)}/export/pdf`}
                className="h-10 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
              >
                PDF
              </a>
              <Link
                href={`/p/${p.projectSlug}/tabletop/${encodeURIComponent(exercise.id)}/session`}
                className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95"
              >
                Run session
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Narrative</div>
          <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{exercise.narrative}</div>
        </section>

        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Injects</div>
            <div className="text-xs text-zinc-500 tabular-nums">{injects.length}</div>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {injects.map((inj) => (
              <div key={inj.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    #{inj.sequence} • T+{inj.tPlusMinutes}m • {inj.title}
                  </div>
                  <div className="text-xs text-zinc-500">{inj.attackTechniqueId ? `Technique: ${inj.attackTechniqueId}` : ""}</div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{inj.situation}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Roles</div>
            <div className="text-xs text-zinc-500 tabular-nums">{roles.length}</div>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {roles.map((r) => (
              <div key={r.id} className="px-6 py-4">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.roleName}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{r.briefing}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Facilitator guide</div>
          <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{exercise.facilitatorGuide}</div>
        </section>
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
