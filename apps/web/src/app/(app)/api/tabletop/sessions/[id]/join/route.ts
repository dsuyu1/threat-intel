export const runtime = "edge";

import { getDb, tabletopExercises, tabletopSessionParticipants, tabletopSessions } from "@ti/db";
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
  const roleName = String(body?.roleName ?? "").trim();
  if (!roleName) return json({ error: "roleName is required" }, { status: 400 });
  if (roleName.length > 80) return json({ error: "roleName is too long" }, { status: 400 });

  try {
    const [row] = await db
      .select({ projectId: tabletopExercises.projectId, status: tabletopSessions.status })
      .from(tabletopSessions)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopSessions.exerciseId))
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });
    if (row.status === ("completed" as any)) return json({ error: "Session is completed" }, { status: 400 });

    await db
      .insert(tabletopSessionParticipants)
      .values({ sessionId, userId: viewer.user.id, roleName, joinedAt: new Date() })
      .onConflictDoUpdate({
        target: [tabletopSessionParticipants.sessionId, tabletopSessionParticipants.userId],
        set: { roleName, joinedAt: new Date() },
      });

    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

