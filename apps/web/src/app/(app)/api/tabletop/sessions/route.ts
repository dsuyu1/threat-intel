export const runtime = "edge";

import { getDb, tabletopExercises, tabletopSessions } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Tabletop exercises are available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const exerciseId = String(body?.exerciseId ?? "").trim();
  if (!exerciseId) return json({ error: "exerciseId is required" }, { status: 400 });

  try {
    const [exercise] = await db
      .select({ id: tabletopExercises.id, status: tabletopExercises.status })
      .from(tabletopExercises)
      .where(and(eq(tabletopExercises.id, exerciseId), eq(tabletopExercises.projectId, viewer.project.id)))
      .limit(1);

    if (!exercise) return json({ error: "Exercise not found" }, { status: 404 });

    const [session] = await db
      .insert(tabletopSessions)
      .values({
        exerciseId,
        facilitatorUserId: viewer.user.id,
        status: "in_progress" as any,
        startedAt: new Date(),
        currentSequence: 0,
      })
      .returning({ id: tabletopSessions.id });

    if (!session?.id) return json({ error: "Failed to create session" }, { status: 500 });

    await db
      .update(tabletopExercises)
      .set({ status: "in_progress" as any, scheduledAt: new Date(), updatedAt: new Date() })
      .where(eq(tabletopExercises.id, exerciseId));

    return json({ ok: true, id: session.id });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

