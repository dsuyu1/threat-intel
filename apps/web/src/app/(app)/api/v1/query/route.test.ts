import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const { runKql } = vi.hoisted(() => ({ runKql: vi.fn() }));
vi.mock("@ti/db", async () => {
  const actual = await vi.importActual<typeof import("@ti/db")>("@ti/db");
  return { ...actual, runKql };
});

const { requireApiKey } = vi.hoisted(() => ({ requireApiKey: vi.fn() }));
vi.mock("../../../../../lib/api-auth", () => ({ requireApiKey }));

const { getUserTierById } = vi.hoisted(() => ({ getUserTierById: vi.fn() }));
vi.mock("../../../../../lib/api-key-tier", () => ({ getUserTierById }));

const { POST } = await import("./route");
const { KqlError } = await vi.importActual<typeof import("@ti/db")>("@ti/db");

describe("/api/v1/query", () => {
  beforeEach(() => {
    runKql.mockReset();
    requireApiKey.mockReset();
    getUserTierById.mockReset();
  });

  it("returns 401 when requireApiKey fails", async () => {
    requireApiKey.mockResolvedValueOnce({
      ok: false,
      res: new Response(JSON.stringify({ error: "Missing API key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });

    const req = new NextRequest("http://localhost/api/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Findings | take 1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Missing API key" });
  });

  it("maps KqlError to 400 with pos", async () => {
    requireApiKey.mockResolvedValueOnce({ ok: true, apiKey: { userId: "u1", projectId: "p1" } });
    getUserTierById.mockResolvedValueOnce("pro");
    runKql.mockRejectedValueOnce(new KqlError("Bad query", 9));

    const req = new NextRequest("http://localhost/api/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "bad" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Bad query", pos: 9 });
  });
});
