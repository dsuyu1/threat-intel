import { describe, expect, it } from "vitest";
import { csvContainsMitreTechniqueId, normalizeMitreTechniqueId } from "./mitre";

describe("MITRE helpers", () => {
  it("normalizes technique IDs", () => {
    expect(normalizeMitreTechniqueId(" t1059 ")).toBe("T1059");
    expect(normalizeMitreTechniqueId("T1059.001")).toBe("T1059.001");
    expect(normalizeMitreTechniqueId("M1040")).toBe("");
  });

  it("matches exact IDs in comma-separated mitre_ids", () => {
    expect(csvContainsMitreTechniqueId("T1059,T1059.001", "T1059")).toBe(true);
    expect(csvContainsMitreTechniqueId("T1059.001", "T1059")).toBe(false);
    expect(csvContainsMitreTechniqueId("T10590", "T1059")).toBe(false);
    expect(csvContainsMitreTechniqueId(null, "T1059")).toBe(false);
  });
});

