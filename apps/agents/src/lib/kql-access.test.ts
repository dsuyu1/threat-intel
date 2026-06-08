import { describe, expect, it } from "vitest";

import { KqlError, compileKqlToSql, listKqlTables, parseKql } from "@ti/db";

describe("KQL access controls", () => {
  it("exposes a stable, sorted allowlist of tables", () => {
    const tables = listKqlTables();
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual([...tables].sort((a, b) => a.localeCompare(b)));
    expect(tables).toContain("Findings");
  });

  it("rejects unknown tables", () => {
    const q = parseKql("Users | take 1");
    expect(() => compileKqlToSql(q)).toThrow(KqlError);
    expect(() => compileKqlToSql(q)).toThrow(/Unknown table/i);
  });

  it("rejects unknown fields (prevents table escape via columns)", () => {
    const q = parseKql("Findings | where password == \"x\"");
    expect(() => compileKqlToSql(q, { projectId: "p1" })).toThrow(KqlError);
    expect(() => compileKqlToSql(q, { projectId: "p1" })).toThrow(/Unknown field/i);
  });
});
