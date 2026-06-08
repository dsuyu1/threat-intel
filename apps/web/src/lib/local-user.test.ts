import { afterEach, describe, expect, it } from "vitest";

import { hasNavigatorAccess } from "./local-user";

describe("hasNavigatorAccess", () => {
  const originalBypass = process.env["NAVIGATOR_BYPASS_PRO"];

  afterEach(() => {
    if (originalBypass === undefined) delete process.env["NAVIGATOR_BYPASS_PRO"];
    else process.env["NAVIGATOR_BYPASS_PRO"] = originalBypass;
  });

  it("allows Pro tier by default", () => {
    delete process.env["NAVIGATOR_BYPASS_PRO"];
    expect(hasNavigatorAccess({ tier: "pro" })).toBe(true);
  });

  it("denies Free tier by default", () => {
    delete process.env["NAVIGATOR_BYPASS_PRO"];
    expect(hasNavigatorAccess({ tier: "free" })).toBe(false);
  });

  it("allows Free tier when NAVIGATOR_BYPASS_PRO=1", () => {
    process.env["NAVIGATOR_BYPASS_PRO"] = "1";
    expect(hasNavigatorAccess({ tier: "free" })).toBe(true);
  });
});

