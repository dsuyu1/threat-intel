import { describe, expect, it } from "vitest";

import {
  iso2ToIsoNumeric,
  isoNumericToIso2,
  isoNumericToRgb,
  rgbToIsoNumeric,
} from "./iso-numeric";

describe("iso-numeric mapping", () => {
  it("maps ISO2 ↔ ISO numeric for common countries", () => {
    expect(iso2ToIsoNumeric("US")).toBe(840);
    expect(isoNumericToIso2(840)).toBe("US");

    expect(iso2ToIsoNumeric("ru")).toBe(643);
    expect(isoNumericToIso2(643)).toBe("RU");

    expect(iso2ToIsoNumeric("FR")).toBe(250);
    expect(isoNumericToIso2(250)).toBe("FR");
  });

  it("round-trips ISO numeric IDs through RGB encoding", () => {
    const ids = [1, 20, 250, 643, 840, 983, 999];
    for (const id of ids) {
      const { r, g, b } = isoNumericToRgb(id);
      expect(rgbToIsoNumeric(r, g, b)).toBe(id);
    }
  });
});

