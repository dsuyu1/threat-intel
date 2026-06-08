import { describe, expect, it } from "vitest";

import { allowedTablesForTier } from "./allowedTables";

describe("allowedTablesForTier", () => {
  it("returns Free tables for unknown tiers", () => {
    expect(allowedTablesForTier("free")).toEqual(["Findings", "Documents", "Sources"]);
    expect(allowedTablesForTier("")).toEqual(["Findings", "Documents", "Sources"]);
    expect(allowedTablesForTier("enterprise")).toEqual(["Findings", "Documents", "Sources"]);
  });

  it("returns Pro tables for pro tier (case-insensitive)", () => {
    expect(allowedTablesForTier("pro")).toEqual([
      "Actors",
      "ActorProfiles",
      "Findings",
      "Documents",
      "Sources",
      "KgEntities",
      "KgRelations",
      "KgEvidence",
      "Iocs",
      "Playbooks",
      "NavigatorScenarios",
      "NavigatorDetections",
      "RiskEntries",
    ]);
    expect(allowedTablesForTier("PRO")).toEqual([
      "Actors",
      "ActorProfiles",
      "Findings",
      "Documents",
      "Sources",
      "KgEntities",
      "KgRelations",
      "KgEvidence",
      "Iocs",
      "Playbooks",
      "NavigatorScenarios",
      "NavigatorDetections",
      "RiskEntries",
    ]);
  });
});
