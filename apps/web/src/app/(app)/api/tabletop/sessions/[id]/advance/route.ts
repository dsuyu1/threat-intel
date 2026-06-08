export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopSessions } from "@ti/db";
import { and, eq, sql } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../../lib/tenancy";

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

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Tabletop exercises are available on Pro." }, { status: 403 });

  const { id } = await ctx2.params;
  const sessionId = String(id ?? "").trim();
  if (!sessionId) return json({ error: "Missing id" }, { status: 400 });

  try {
    const [row] = await db
      .select({
        id: tabletopSessions.id,
        status: tabletopSessions.status,
        currentSequence: tabletopSessions.currentSequence,
        exerciseId: tabletopSessions.exerciseId,
        facilitatorUserId: tabletopSessions.facilitatorUserId,
        projectId: tabletopExercises.projectId,
      })
      .from(tabletopSessions)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopSessions.exerciseId))
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });
    if (row.facilitatorUserId !== viewer.user.id) return json({ error: "Facilitator access required" }, { status: 403 });
    if (row.status !== ("in_progress" as any)) return json({ error: "Session is not in progress" }, { status: 400 });

    const next = Math.max(0, Number(row.currentSequence ?? 0)) + 1;

    const [maxRow] = await db
      .select({ maxSeq: sql<number>`max(${tabletopInjects.sequence})` })
      .from(tabletopInjects)
      .where(eq(tabletopInjects.exerciseId, row.exerciseId))
      .limit(1);

    const maxSeq = Number(maxRow?.maxSeq ?? 0);
    if (!Number.isFinite(maxSeq) || maxSeq <= 0) return json({ error: "Exercise has no injects" }, { status: 400 });
    if (next > maxSeq) return json({ ok: true, currentSequence: row.currentSequence, done: true });

    await db
      .update(tabletopSessions)
      .set({ currentSequence: next, updatedAt: new Date() })
      .where(eq(tabletopSessions.id, sessionId));

    return json({ ok: true, currentSequence: next, done: false });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

