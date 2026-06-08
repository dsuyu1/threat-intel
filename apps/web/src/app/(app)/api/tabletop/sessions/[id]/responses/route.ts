export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopSessionParticipants, tabletopSessionResponses, tabletopSessions } from "@ti/db";
import { and, eq } from "drizzle-orm";
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

  const body = (await req.json().catch(() => null)) as any;
  const injectId = String(body?.injectId ?? "").trim();
  const response = String(body?.response ?? "").trim();
  const roleNameInput = String(body?.roleName ?? "").trim();
  if (!injectId) return json({ error: "injectId is required" }, { status: 400 });
  if (!response) return json({ error: "response is required" }, { status: 400 });
  if (response.length > 20_000) return json({ error: "response is too long" }, { status: 400 });

  try {
    const [row] = await db
      .select({
        projectId: tabletopExercises.projectId,
        exerciseId: tabletopSessions.exerciseId,
        currentSequence: tabletopSessions.currentSequence,
        status: tabletopSessions.status,
      })
      .from(tabletopSessions)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopSessions.exerciseId))
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });
    if (row.status === ("completed" as any)) return json({ error: "Session is completed" }, { status: 400 });

    const [inj] = await db
      .select({ id: tabletopInjects.id, sequence: tabletopInjects.sequence })
      .from(tabletopInjects)
      .where(and(eq(tabletopInjects.id, injectId), eq(tabletopInjects.exerciseId, row.exerciseId)))
      .limit(1);

    if (!inj) return json({ error: "Inject not found" }, { status: 404 });
    const currentSeq = Math.max(0, Number(row.currentSequence ?? 0));
    if (!(Number(inj.sequence) <= currentSeq)) return json({ error: "Inject is not released yet" }, { status: 400 });

    const [me] = await db
      .select({ roleName: tabletopSessionParticipants.roleName })
      .from(tabletopSessionParticipants)
      .where(and(eq(tabletopSessionParticipants.sessionId, sessionId), eq(tabletopSessionParticipants.userId, viewer.user.id)))
      .limit(1);

    const roleName = roleNameInput || me?.roleName || "Participant";
    if (roleName.length > 80) return json({ error: "roleName is too long" }, { status: 400 });

    const [created] = await db
      .insert(tabletopSessionResponses)
      .values({ sessionId, injectId, userId: viewer.user.id, roleName, response, createdAt: new Date() })
      .returning({ id: tabletopSessionResponses.id });

    return json({ ok: true, id: created?.id ?? null });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
