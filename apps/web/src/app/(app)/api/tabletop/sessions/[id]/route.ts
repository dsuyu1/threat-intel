export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopSessionParticipants, tabletopSessions } from "@ti/db";
import { and, asc, eq, lte } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

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

export async function GET(req: Request, ctx2: { params: Promise<{ id: string }> }) {
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
        sessionId: tabletopSessions.id,
        exerciseId: tabletopSessions.exerciseId,
        facilitatorUserId: tabletopSessions.facilitatorUserId,
        status: tabletopSessions.status,
        currentSequence: tabletopSessions.currentSequence,
        startedAt: tabletopSessions.startedAt,
        endedAt: tabletopSessions.endedAt,
        exerciseTitle: tabletopExercises.title,
        projectId: tabletopExercises.projectId,
      })
      .from(tabletopSessions)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopSessions.exerciseId))
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });

    const currentSequence = Math.max(0, Number(row.currentSequence ?? 0));
    const releasedInjects =
      currentSequence <= 0
        ? []
        : await db
            .select()
            .from(tabletopInjects)
            .where(and(eq(tabletopInjects.exerciseId, row.exerciseId), lte(tabletopInjects.sequence, currentSequence)))
            .orderBy(asc(tabletopInjects.sequence))
            .limit(50);

    const [me] = await db
      .select({ roleName: tabletopSessionParticipants.roleName })
      .from(tabletopSessionParticipants)
      .where(and(eq(tabletopSessionParticipants.sessionId, sessionId), eq(tabletopSessionParticipants.userId, viewer.user.id)))
      .limit(1);

    return json({
      ok: true,
      session: {
        id: row.sessionId,
        exerciseId: row.exerciseId,
        status: row.status,
        facilitatorUserId: row.facilitatorUserId,
        currentSequence: row.currentSequence,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      },
      exercise: { id: row.exerciseId, title: row.exerciseTitle },
      releasedInjects,
      me: { roleName: me?.roleName ?? null, isFacilitator: row.facilitatorUserId === viewer.user.id },
    });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
