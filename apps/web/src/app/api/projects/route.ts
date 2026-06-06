export const runtime = "edge";

import { getDb, projects, userPreferences } from "@ti/db";
import { and, eq, sql } from "drizzle-orm";
import { getViewerContext, listTeamProjects } from "../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function slugify(value: string) {
  const base = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "project";
}

export async function GET(req: Request) {
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const rows = await listTeamProjects({ teamId: ctx.team.id });
  return json({ ok: true, team: ctx.team, project: ctx.project, projects: rows });
}

export async function POST(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();

  const body = (await req.json().catch(() => null)) as any;
  const name = String(body?.name ?? "").trim();
  if (!name) return json({ error: "name is required" }, { status: 400 });

  const baseSlug = slugify(body?.slug ? String(body.slug) : name);
  const existingRows = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.teamId, ctx.team.id), sql`${projects.slug} like ${`${baseSlug}%`}`))
    .limit(200);
  const existing = new Set(existingRows.map((r) => r.slug));

  let slug = baseSlug;
  let n = 2;
  while (existing.has(slug)) {
    slug = `${baseSlug}-${n++}`;
  }

  const [created] = await db
    .insert(projects)
    .values({ teamId: ctx.team.id, slug, name })
    .returning({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name });

  if (!created) return json({ error: "Failed to create project" }, { status: 500 });

  // Make the newly created project the default for the creator.
  await db
    .insert(userPreferences)
    .values({ userId: ctx.user.id, defaultProjectId: created.id })
    .onConflictDoUpdate({
      target: [userPreferences.userId],
      set: { defaultProjectId: created.id, updatedAt: new Date() },
    });

  return json({ ok: true, project: created });
}
