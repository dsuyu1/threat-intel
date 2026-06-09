import { describe, expect, test, vi } from "vitest";

const authMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

type FakeSelectRow = Record<string, unknown>;

function rowForSelection(selection: Record<string, unknown>): FakeSelectRow[] {
  const keys = Object.keys(selection ?? {});

  if (keys.includes("defaultProjectId")) return [{ defaultProjectId: null }];
  if (keys.includes("clerkOrgId")) return [{ id: "t1", clerkOrgId: "personal:u1", name: "Personal" }];
  if (keys.includes("teamId") && keys.includes("slug"))
    return [{ id: "p1", teamId: "t1", slug: "default", name: "Default" }];
  if (keys.includes("tier") && keys.includes("email"))
    return [{ id: "u1", tier: "pro", email: "local@threat-intel.dev", clerkId: "local" }];

  // Default: return a single row with nulls for requested keys.
  const out: FakeSelectRow = {};
  for (const k of keys) out[k] = null;
  return [out];
}

class FakeSelect {
  private selection: Record<string, unknown>;
  constructor(selection: Record<string, unknown>) {
    this.selection = selection;
  }
  from() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return Promise.resolve(rowForSelection(this.selection));
  }
}

class FakeInsert {
  values() {
    return this;
  }
  onConflictDoNothing() {
    return Promise.resolve();
  }
  onConflictDoUpdate() {
    return Promise.resolve();
  }
  returning() {
    return Promise.resolve([{ id: "x" }]);
  }
}

class FakeUpdate {
  set() {
    return this;
  }
  where() {
    return Promise.resolve();
  }
}

const fakeDb = {
  select(selection: Record<string, unknown>) {
    return new FakeSelect(selection);
  },
  insert() {
    return new FakeInsert();
  },
  update() {
    return new FakeUpdate();
  },
};

vi.mock("@ti/db", () => ({
  getDb: () => fakeDb,
  users: { id: "users.id", tier: "users.tier", email: "users.email", clerkId: "users.clerkId" },
  teams: { id: "teams.id", clerkOrgId: "teams.clerk_org_id", name: "teams.name" },
  projects: { id: "projects.id", teamId: "projects.team_id", slug: "projects.slug", name: "projects.name" },
  userPreferences: { userId: "user_preferences.user_id", defaultProjectId: "user_preferences.default_project_id" },
}));

describe("getViewerContext beta fallback", () => {
  test("does not throw in production when NAVIGATOR_PUBLIC_BETA is enabled and Clerk auth() throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NAVIGATOR_PUBLIC_BETA", "1");
    authMock.mockImplementation(() => {
      throw new Error("Clerk down");
    });

    const { getViewerContext } = await import("./tenancy");
    const ctx = await getViewerContext();
    expect(ctx.clerk.userId).toBe(null);
    expect(ctx.project.slug).toBe("default");
  });

  test("fails closed in production when NAVIGATOR_PUBLIC_BETA is disabled and Clerk auth() throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NAVIGATOR_PUBLIC_BETA", "");
    authMock.mockImplementation(() => {
      throw new Error("Clerk down");
    });

    const { getViewerContext } = await import("./tenancy");
    await expect(getViewerContext()).rejects.toThrow(/Clerk unavailable/i);
  });
});

