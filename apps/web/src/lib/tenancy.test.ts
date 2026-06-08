import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth }));

vi.mock("@ti/db", async () => {
  const actual = await vi.importActual<typeof import("@ti/db")>("@ti/db");

  const userRow = { id: "user-123", tier: "pro", email: "local@threat-intel.dev", clerkId: "local" };
  const teamRow = { id: "team-123", clerkOrgId: `personal:${userRow.id}`, name: "Personal" };
  const projectRow = { id: "proj-123", teamId: teamRow.id, slug: "default", name: "Default" };

  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () => {
            if (table === actual.users) return [userRow];
            if (table === actual.teams) return [teamRow];
            if (table === actual.userPreferences) return [{ defaultProjectId: projectRow.id }];
            if (table === actual.projects) return [projectRow];
            return [];
          },
        }),
        limit: async () => [],
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
        onConflictDoUpdate: async () => {},
      }),
    }),
  };

  return { ...actual, getDb: () => db };
});

const { getViewerContext } = await import("./tenancy");

describe("getViewerContext() auth behavior", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env["NODE_ENV"];
  const originalClerkId = process.env["NAVIGATOR_LOCAL_CLERK_ID"];
  const originalEmail = process.env["NAVIGATOR_LOCAL_EMAIL"];
  const originalTier = process.env["NAVIGATOR_LOCAL_TIER"];

  beforeEach(() => {
    auth.mockReset();
    process.env["NAVIGATOR_LOCAL_CLERK_ID"] = "local";
    process.env["NAVIGATOR_LOCAL_EMAIL"] = "local@threat-intel.dev";
    process.env["NAVIGATOR_LOCAL_TIER"] = "pro";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env["NODE_ENV"];
    else env["NODE_ENV"] = originalNodeEnv;
    if (originalClerkId === undefined) delete process.env["NAVIGATOR_LOCAL_CLERK_ID"];
    else process.env["NAVIGATOR_LOCAL_CLERK_ID"] = originalClerkId;
    if (originalEmail === undefined) delete process.env["NAVIGATOR_LOCAL_EMAIL"];
    else process.env["NAVIGATOR_LOCAL_EMAIL"] = originalEmail;
    if (originalTier === undefined) delete process.env["NAVIGATOR_LOCAL_TIER"];
    else process.env["NAVIGATOR_LOCAL_TIER"] = originalTier;
  });

  it("fails closed in production if Clerk auth throws", async () => {
    env["NODE_ENV"] = "production";
    auth.mockRejectedValueOnce(new Error("boom"));
    await expect(getViewerContext()).rejects.toThrow(/clerk unavailable/i);
  });

  it("fails closed in production when unauthenticated", async () => {
    env["NODE_ENV"] = "production";
    auth.mockResolvedValueOnce({ userId: null, orgId: null } as any);
    await expect(getViewerContext()).rejects.toThrow(/not authenticated/i);
  });

  it("uses local auth fallback in development when unauthenticated", async () => {
    env["NODE_ENV"] = "development";
    auth.mockResolvedValueOnce({ userId: null, orgId: null } as any);
    const ctx = await getViewerContext();
    expect(ctx.clerk.userId).toBeNull();
    expect(ctx.user.email).toBe("local@threat-intel.dev");
    expect(String(ctx.user.tier)).toBe("pro");
  });

  it("uses local auth fallback in development when Clerk auth throws", async () => {
    env["NODE_ENV"] = "development";
    auth.mockRejectedValueOnce(new Error("boom"));
    const ctx = await getViewerContext();
    expect(ctx.clerk.userId).toBeNull();
    expect(ctx.user.email).toBe("local@threat-intel.dev");
  });
});
