import { describe, expect, it } from "vitest";

import { KqlError, compileKqlToSql, getKqlTableSchemas, parseKql } from "@ti/db";
import { allowedTablesForTier } from "./allowedTables";
import { detectRelativeTimeWindow, ensureTakeStage, parseNlqModelResponse } from "./nlq";

describe("detectRelativeTimeWindow", () => {
  it("parses 'last 6 months' using UTC calendar subtraction", () => {
    const now = new Date("2026-06-07T12:00:00.000Z");
    const tw = detectRelativeTimeWindow("in the last 6 months", now);
    expect(tw?.sinceIso).toBe("2025-12-07T12:00:00.000Z");
    expect(tw?.untilIso).toBe("2026-06-07T12:00:00.000Z");
    expect(tw?.amount).toBe(6);
    expect(tw?.unit).toBe("month");
  });

  it("parses 'past 2 weeks'", () => {
    const now = new Date("2026-06-07T12:00:00.000Z");
    const tw = detectRelativeTimeWindow("past 2 weeks", now);
    expect(tw?.sinceIso).toBe("2026-05-24T12:00:00.000Z");
    expect(tw?.unit).toBe("week");
  });

  it("parses 'last month' as 1 month", () => {
    const now = new Date("2026-06-07T12:00:00.000Z");
    const tw = detectRelativeTimeWindow("last month", now);
    expect(tw?.sinceIso).toBe("2026-05-07T12:00:00.000Z");
    expect(tw?.amount).toBe(1);
    expect(tw?.unit).toBe("month");
  });
});

describe("parseNlqModelResponse", () => {
  it("parses JSON output", () => {
    const r = parseNlqModelResponse('{"kql":"Actors | take 1","explanation":"test"}');
    expect(r.kql).toBe("Actors | take 1");
    expect(r.explanation).toBe("test");
  });

  it("parses JSON inside code fences", () => {
    const r = parseNlqModelResponse('```json\n{"kql":"Actors | take 1","explanation":"ok"}\n```');
    expect(r.kql).toBe("Actors | take 1");
    expect(r.explanation).toBe("ok");
  });
});

describe("ensureTakeStage", () => {
  it("appends take when missing", () => {
    expect(ensureTakeStage("Actors | project actorId,name", 50)).toContain("| take 50");
  });

  it("does not append when take exists", () => {
    expect(ensureTakeStage("Actors | take 10", 50)).toBe("Actors | take 10");
  });
});

describe("KQL allowed-tables enforcement", () => {
  it("rejects disallowed tables for free tier", () => {
    const allowedTables = allowedTablesForTier("free");
    const ast = parseKql("Actors | take 1");
    expect(() => compileKqlToSql(ast, { allowedTables })).toThrow(KqlError);
  });

  it("getKqlTableSchemas respects allowedTables", () => {
    const allowedTables = allowedTablesForTier("free");
    const schemas = getKqlTableSchemas({ allowedTables });
    const names = schemas.map((s) => s.name);
    expect(names).toContain("Findings");
    expect(names).not.toContain("Actors");
  });
});

