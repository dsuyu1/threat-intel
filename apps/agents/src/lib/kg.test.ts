import { describe, expect, it } from "vitest";

import { normalizeAlias } from "./kg";

describe("normalizeAlias()", () => {
  it("lowercases and normalizes whitespace/punctuation", () => {
    expect(normalizeAlias("  Cozy-Bear!! ")).toBe("cozy bear");
  });

  it("keeps alphanumerics", () => {
    expect(normalizeAlias("APT29")).toBe("apt29");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeAlias("a   b\tc")).toBe("a b c");
  });
});
