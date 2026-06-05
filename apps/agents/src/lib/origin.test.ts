import { describe, expect, it } from "vitest";

import { inferOriginFromText } from "./origin";

describe("inferOriginFromText()", () => {
  it("infers RU from common MITRE phrasing", () => {
    const text =
      "APT29 is threat group that has been attributed to Russia's Foreign Intelligence Service (SVR).";
    expect(inferOriginFromText(text)?.iso2).toBe("RU");
  });

  it("infers KP from demonym + attribution language", () => {
    const text = "Lazarus Group is a North Korean cyber threat group that has targeted multiple sectors.";
    expect(inferOriginFromText(text)?.iso2).toBe("KP");
  });
});

