import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const { requireApiKey } = vi.hoisted(() => ({ requireApiKey: vi.fn() }));
vi.mock("../../../../../../lib/api-auth", () => ({ requireApiKey }));

const { getUserTierById } = vi.hoisted(() => ({ getUserTierById: vi.fn() }));
vi.mock("../../../../../../lib/api-key-tier", () => ({ getUserTierById }));

const { POST } = await import("./route");

describe("/api/v1/navigator/detections", () => {
  beforeEach(() => {
    requireApiKey.mockReset();
    getUserTierById.mockReset();
  });

  it("returns 403 for non-pro tier", async () => {
    requireApiKey.mockResolvedValueOnce({ ok: true, apiKey: { userId: "u1", projectId: "p1" } });
    getUserTierById.mockResolvedValueOnce("free");

    const req = new NextRequest("http://localhost/api/v1/navigator/detections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ techniqueId: "T1059" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(String(data.error)).toMatch(/pro/i);
  });
});
