export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopRoles } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
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
  const exerciseId = String(id ?? "").trim();
  if (!exerciseId) return json({ error: "Missing id" }, { status: 400 });

  try {
    const [exercise] = await db
      .select()
      .from(tabletopExercises)
      .where(and(eq(tabletopExercises.id, exerciseId), eq(tabletopExercises.projectId, viewer.project.id)))
      .limit(1);

    if (!exercise) return json({ error: "Not found" }, { status: 404 });

    const injects = await db
      .select()
      .from(tabletopInjects)
      .where(eq(tabletopInjects.exerciseId, exerciseId))
      .orderBy(asc(tabletopInjects.sequence))
      .limit(50);

    const roles = await db
      .select()
      .from(tabletopRoles)
      .where(eq(tabletopRoles.exerciseId, exerciseId))
      .orderBy(asc(tabletopRoles.roleName))
      .limit(50);

    return json({ ok: true, exercise, injects, roles });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

