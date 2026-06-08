import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const { runKql } = vi.hoisted(() => ({ runKql: vi.fn() }));
vi.mock("@ti/db", async () => {
  const actual = await vi.importActual<typeof import("@ti/db")>("@ti/db");
  return { ...actual, runKql };
});

const { getViewerContext } = vi.hoisted(() => ({ getViewerContext: vi.fn() }));
vi.mock("../../../../lib/tenancy", () => ({ getViewerContext }));

const { GET, POST } = await import("./route");
const { KqlError } = await vi.importActual<typeof import("@ti/db")>("@ti/db");

describe("/api/query", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env["NODE_ENV"];

  beforeEach(() => {
    runKql.mockReset();
    getViewerContext.mockReset();
    getViewerContext.mockResolvedValue({
      user: { id: "u1", email: "u1@example.com", tier: "pro", clerkId: "clerk_u1" },
      team: { id: "t1", clerkOrgId: "org1", name: "Team" },
      project: { id: "p1", teamId: "t1", slug: "default", name: "Default" },
      clerk: { userId: null, orgId: null },
    });
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env["NODE_ENV"];
    else env["NODE_ENV"] = originalNodeEnv;
  });

  it("GET returns 401 in production when unauthenticated", async () => {
    env["NODE_ENV"] = "production";
    const req = new NextRequest("http://localhost/api/query?q=Findings%20%7C%20take%201");
    const res = await GET(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("GET returns 400 when q is missing", async () => {
    env["NODE_ENV"] = "development";
    const req = new NextRequest("http://localhost/api/query");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/missing query/i);
  });

  it("GET maps KqlError to 400 with position", async () => {
    env["NODE_ENV"] = "development";
    runKql.mockRejectedValueOnce(new KqlError("Bad query", 12));

    const req = new NextRequest("http://localhost/api/query?q=Findings%20%7C%20take%201");
    const res = await GET(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Bad query", pos: 12 });
  });

  it("POST returns 400 when body.query is missing", async () => {
    env["NODE_ENV"] = "development";
    const req = new NextRequest("http://localhost/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/missing query/i);
  });
});
