import { describe, expect, it } from "vitest";
import { assignPercentileScores, classifyKevStackMatch } from "@ti/db";

describe("Navigator scoring", () => {
  it("assigns stable percentiles (ties share score)", () => {
    const items = [
      { scenarioKey: "a", rawPriority: 0.1 },
      { scenarioKey: "b", rawPriority: 0.1 },
      { scenarioKey: "c", rawPriority: 0.9 },
    ];
    const scores = assignPercentileScores(items);
    expect(scores.get("a")).toBe(scores.get("b"));
    expect(scores.get("c")).toBe(100);
  });

  it("shifts percentiles when adding a new high-priority scenario", () => {
    const base = [
      { scenarioKey: "a", rawPriority: 0.1 },
      { scenarioKey: "b", rawPriority: 0.5 },
      { scenarioKey: "c", rawPriority: 0.9 },
    ];
    const baseScores = assignPercentileScores(base);
    expect(baseScores.get("c")).toBe(100);

    const next = [...base, { scenarioKey: "d", rawPriority: 0.95 }];
    const nextScores = assignPercentileScores(next);
    expect(nextScores.get("d")).toBe(100);
    expect(nextScores.get("c")).toBeLessThan(100);
  });

  it("classifies CVE stack match vs unknown-match", () => {
    const hit = classifyKevStackMatch({
      userStack: ["Microsoft Exchange", "nginx"],
      kevVendorProject: "Microsoft",
      kevProduct: "Exchange Server",
    });
    expect(hit.kind).toBe("match");

    const unknown = classifyKevStackMatch({
      userStack: ["nginx"],
      kevVendorProject: null,
      kevProduct: null,
    });
    expect(unknown.kind).toBe("unknown-match");

    const miss = classifyKevStackMatch({
      userStack: ["nginx"],
      kevVendorProject: "Microsoft",
      kevProduct: "Exchange Server",
    });
    expect(miss.kind).toBe("no-match");
  });
});

