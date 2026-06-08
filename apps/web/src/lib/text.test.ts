import { describe, expect, test } from "vitest";
import { fixText } from "./text";

describe("fixText", () => {
  test("repairs common Windows-1252 mojibake (â€™)", () => {
    expect(fixText(`ct\u00e2\u20ac\u2122s`)).toBe(`ct\u2019s`);
  });

  test("repairs control-code variant (â\u0080\u0099)", () => {
    expect(fixText(`\u00e2\u0080\u0099`)).toBe(`\u2019`);
  });

  test("repairs Latin-1 -> UTF-8 decode cases (CÃ´te)", () => {
    expect(fixText("CÃ´te d'Ivoire")).toBe("Côte d'Ivoire");
  });

  test("repairs arrow variants", () => {
    expect(fixText(`\u00e2\u0086\u0092`)).toBe("\u2192");
  });
});

