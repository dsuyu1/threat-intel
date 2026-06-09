import "server-only";

import { getDb, projects, teams, userPreferences, users } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export type ViewerUser = { id: string; email: string; tier: string; clerkId: string };
export type ViewerTeam = { id: string; clerkOrgId: string; name: string };
export type ViewerProject = { id: string; teamId: string; slug: string; name: string };

export type ViewerContext = {
  user: ViewerUser;
  team: ViewerTeam;
  project: ViewerProject;
  clerk: { userId: string | null; orgId: string | null };
};

function safeEmailForClerkId(clerkId: string) {
  const s = String(clerkId ?? "").trim();
  const slug = s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64) || "user";
  return `${slug}@threat-intel.local`;
}

function getLocalFallback() {
  const clerkId = process.env["NAVIGATOR_LOCAL_CLERK_ID"] ?? "local";
  const email = process.env["NAVIGATOR_LOCAL_EMAIL"] ?? "local@threat-intel.dev";
  const tier = (process.env["NAVIGATOR_LOCAL_TIER"] ?? "pro") === "free" ? "free" : "pro";
  return { clerkId, email, tier };
}

function allowLocalAuthFallback() {
  // NOTE (beta): In production we normally fail-closed and require Clerk auth.
  // While the product is in a public beta (no payments / no auth-gated access),
  // enable a temporary "public beta" mode that mints a local viewer context when
  // the request is unauthenticated. Turn this OFF before GA / billing.
  const publicBeta =
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "1" ||
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "true";
  return process.env.NODE_ENV !== "production" || publicBeta;
}

async function getOrCreateUser(params: { clerkId: string; email: string; tier: string }) {
  const db = getDb();
  const [existing] = await db
    .select({ id: users.id, tier: users.tier, email: users.email, clerkId: users.clerkId })
    .from(users)
    .where(eq(users.clerkId, params.clerkId))
    .limit(1);

  if (existing) return existing;

  await db
    .insert(users)
    .values({ email: params.email, clerkId: params.clerkId, tier: params.tier as any })
    .onConflictDoNothing();

  const [created] = await db
    .select({ id: users.id, tier: users.tier, email: users.email, clerkId: users.clerkId })
    .from(users)
    .where(eq(users.clerkId, params.clerkId))
    .limit(1);

  if (!created) throw new Error("Failed to create user");
  return created;
}

async function getOrCreateTeam(params: { clerkOrgId: string; name: string }) {
  const db = getDb();

  const [existing] = await db
    .select({ id: teams.id, clerkOrgId: teams.clerkOrgId, name: teams.name })
    .from(teams)
    .where(eq(teams.clerkOrgId, params.clerkOrgId))
    .limit(1);

  if (existing) return existing;

  await db
    .insert(teams)
    .values({ clerkOrgId: params.clerkOrgId, name: params.name })
    .onConflictDoNothing();

  const [created] = await db
    .select({ id: teams.id, clerkOrgId: teams.clerkOrgId, name: teams.name })
    .from(teams)
    .where(eq(teams.clerkOrgId, params.clerkOrgId))
    .limit(1);

  if (!created) throw new Error("Failed to create team");
  return created;
}

async function getOrCreateDefaultProject(params: { teamId: string }) {
  const db = getDb();
  const [existing] = await db
    .select({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.teamId, params.teamId), eq(projects.slug, "default")))
    .limit(1);
  if (existing) return existing;

  await db
    .insert(projects)
    .values({ teamId: params.teamId, slug: "default", name: "Default" })
    .onConflictDoNothing();

  const [created] = await db
    .select({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.teamId, params.teamId), eq(projects.slug, "default")))
    .limit(1);
  if (!created) throw new Error("Failed to create default project");
  return created;
}

async function getProjectBySlug(params: { teamId: string; projectSlug: string }) {
  const db = getDb();
  const [row] = await db
    .select({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.teamId, params.teamId), eq(projects.slug, params.projectSlug)))
    .limit(1);
  return row ?? null;
}

async function getUserDefaultProjectId(params: { userId: string }) {
  const db = getDb();
  const [row] = await db
    .select({ defaultProjectId: userPreferences.defaultProjectId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, params.userId))
    .limit(1);
  return row?.defaultProjectId ?? null;
}

async function setUserDefaultProjectId(params: { userId: string; projectId: string | null }) {
  const db = getDb();
  await db
    .insert(userPreferences)
    .values({ userId: params.userId, defaultProjectId: params.projectId })
    .onConflictDoUpdate({
      target: [userPreferences.userId],
      set: { defaultProjectId: params.projectId, updatedAt: new Date() },
    });
}

export async function getViewerContext(params?: { projectSlug?: string | null }) {
  const db = getDb();
  const isProduction = process.env.NODE_ENV === "production";

  let clerkUserId: string | null = null;
  let clerkOrgId: string | null = null;
  let authFailed = false;
  try {
    const a = await auth();
    clerkUserId = a.userId ?? null;
    clerkOrgId = (a as any).orgId ?? null;
  } catch (err) {
    authFailed = true;
    if (isProduction) throw new Error("Clerk unavailable", { cause: err as any });
  }

  const shouldUseFallback = !clerkUserId && allowLocalAuthFallback();
  if (!clerkUserId && !shouldUseFallback) {
    // Fail closed in production: do not mint a privileged "local" user if Clerk is down/misconfigured,
    // or if the request is unauthenticated.
    if (authFailed) {
      throw new Error("Clerk auth() failed and no userId is available.");
    }
    throw new Error("Not authenticated.");
  }

  const fallback = shouldUseFallback ? getLocalFallback() : null;
  const clerkId = clerkUserId ?? fallback?.clerkId ?? "unknown";
  const email = (clerkUserId ? safeEmailForClerkId(clerkId) : fallback?.email) ?? safeEmailForClerkId(clerkId);
  const tier = fallback?.tier ?? "free";

  const user = await getOrCreateUser({ clerkId, email, tier });

  const team = await (async () => {
    if (clerkOrgId) return getOrCreateTeam({ clerkOrgId, name: "Team" });
    return getOrCreateTeam({ clerkOrgId: `personal:${user.id}`, name: "Personal" });
  })();

  const project = await (async () => {
    const slug = params?.projectSlug ? String(params.projectSlug).trim() : "";
    if (slug) {
      const bySlug = await getProjectBySlug({ teamId: team.id, projectSlug: slug });
      if (!bySlug) throw new Error("Project not found");
      return bySlug;
    }

    const defaultProjectId = await getUserDefaultProjectId({ userId: user.id });
    if (defaultProjectId) {
      const [p] = await db
        .select({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name })
        .from(projects)
        .where(eq(projects.id, defaultProjectId))
        .limit(1);
      if (p && p.teamId === team.id) return p;
    }

    const fallbackProject = await getOrCreateDefaultProject({ teamId: team.id });
    await setUserDefaultProjectId({ userId: user.id, projectId: fallbackProject.id });
    return fallbackProject;
  })();

  return { user, team, project, clerk: { userId: clerkUserId, orgId: clerkOrgId } } satisfies ViewerContext;
}

export async function listTeamProjects(params: { teamId: string }) {
  const db = getDb();
  return db
    .select({ id: projects.id, teamId: projects.teamId, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.teamId, params.teamId))
    .orderBy(asc(projects.name))
    .limit(200);
}
