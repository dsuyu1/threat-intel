import { describe, expect, it } from "vitest";
import { normalizeSector, resolveSector } from "./sectors.js";

describe("sectors", () => {
  it("normalizes common shapes", () => {
    expect(normalizeSector("Critical Infrastructure")).toBe("critical-infrastructure");
    expect(normalizeSector("health_care")).toBe("health-care");
    expect(normalizeSector("  Financial Services ")).toBe("financial-services");
  });

  it("resolves aliases into canonical sectors", () => {
    expect(resolveSector("health care")).toBe("healthcare");
    expect(resolveSector("Telecommunications")).toBe("telecom");
    expect(resolveSector("Public Sector")).toBe("government");
    expect(resolveSector("IT")).toBe("technology");
  });
});

