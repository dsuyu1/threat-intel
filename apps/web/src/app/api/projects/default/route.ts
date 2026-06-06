export const runtime = "edge";

import { getDb, projects, userPreferences } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function POST(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();

  const body = (await req.json().catch(() => null)) as any;
  const projectId = body?.projectId ? String(body.projectId) : null;
  const projectSlug = body?.projectSlug ? String(body.projectSlug) : null;

  if (!projectId && !projectSlug) {
    return json({ error: "projectId or projectSlug is required" }, { status: 400 });
  }

  const [p] = await db
    .select({ id: projects.id, teamId: projects.teamId })
    .from(projects)
    .where(
      projectId
        ? eq(projects.id, projectId)
        : and(eq(projects.teamId, ctx.team.id), eq(projects.slug, projectSlug!))
    )
    .limit(1);

  if (!p || p.teamId !== ctx.team.id) return json({ error: "Project not found" }, { status: 404 });

  await db
    .insert(userPreferences)
    .values({ userId: ctx.user.id, defaultProjectId: p.id })
    .onConflictDoUpdate({
      target: [userPreferences.userId],
      set: { defaultProjectId: p.id, updatedAt: new Date() },
    });

  return json({ ok: true });
}

