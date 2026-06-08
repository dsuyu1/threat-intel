export const runtime = "edge";

import { getDb, tabletopExercises, tabletopSessions } from "@ti/db";
import { eq } from "drizzle-orm";
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
        exerciseId: tabletopSessions.exerciseId,
        facilitatorUserId: tabletopSessions.facilitatorUserId,
      })
      .from(tabletopSessions)
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.facilitatorUserId !== viewer.user.id) return json({ error: "Facilitator access required" }, { status: 403 });

    const now = new Date();

    await db
      .update(tabletopSessions)
      .set({ status: "completed" as any, endedAt: now, updatedAt: now })
      .where(eq(tabletopSessions.id, sessionId));

    await db
      .update(tabletopExercises)
      .set({ status: "completed" as any, completedAt: now, updatedAt: now })
      .where(eq(tabletopExercises.id, row.exerciseId));

    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

