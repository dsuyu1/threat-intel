import { describe, expect, it } from "vitest";

import { inferCoords } from "./geo";

describe("inferCoords()", () => {
  it("is deterministic for the same seed", () => {
    const tags = JSON.stringify(["finance", "russia"]);
    const a = inferCoords(tags, "attack", "finding-123");
    const b = inferCoords(tags, "attack", "finding-123");
    expect(a).toEqual(b);
  });

  it("varies when the seed changes", () => {
    const tags = JSON.stringify(["finance", "russia"]);
    const a = inferCoords(tags, "attack", "finding-123");
    const b = inferCoords(tags, "attack", "finding-456");
    expect(a).not.toEqual(b);
  });

  it("is deterministic even without an explicit seed", () => {
    const tags = JSON.stringify(["finance", "russia"]);
    const a = inferCoords(tags, "attack");
    const b = inferCoords(tags, "attack");
    expect(a).toEqual(b);
  });
});
