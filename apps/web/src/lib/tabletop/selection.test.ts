import { describe, expect, test } from "vitest";
import { injectCountForDuration, pickActor, pickInitialAccess, pickTechniqueChain, tPlusSchedule } from "./selection";

describe("tabletop selection", () => {
  test("injectCountForDuration matches presets", () => {
    expect(injectCountForDuration(90)).toBe(5);
    expect(injectCountForDuration(120)).toBe(6);
    expect(injectCountForDuration(240)).toBe(8);
  });

  test("tPlusSchedule is increasing and sized", () => {
    const out = tPlusSchedule(120, 6);
    expect(out).toHaveLength(6);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]!);
    expect(out[0]).toBeGreaterThan(0);
  });

  test("pickTechniqueChain prefers gap techniques and avoids recent when possible", () => {
    const chain = pickTechniqueChain({
      injectCount: 5,
      gapTechniqueIds: ["T1111", "T2222", "T3333"],
      actorTechniqueIds: ["T2222", "T4444", "T5555"],
      recentTechniqueIds: ["T1111", "T4444"],
    });
    expect(chain).toHaveLength(5);
    expect(chain).toContain("T2222");
    expect(chain).toContain("T3333");
    // Avoided if possible
    expect(chain[0]).not.toBe("T1111");
  });

  test("pickActor scores overlap and penalizes repeats", () => {
    const a = pickActor({
      scenarioType: "ransomware",
      projectSector: "finance",
      gapTechniqueIds: ["T1111", "T2222"],
      gapCveIds: ["CVE-2024-1234"],
      recentActorScenarioPairs: [{ actorId: "actorA", scenarioType: "ransomware" }],
      candidates: [
        {
          actorId: "actorA",
          actorName: "A",
          usesTechniques: ["T1111"],
          exploitsCves: ["CVE-2024-1234"],
          targetsSectors: ["finance"],
        },
        {
          actorId: "actorB",
          actorName: "B",
          usesTechniques: ["T1111", "T2222"],
          exploitsCves: [],
          targetsSectors: ["finance"],
        },
      ],
    });
    // actorA has bigger overlap but is penalized for recent reuse; actorB should win in this setup
    expect(a?.actorId).toBe("actorB");
  });

  test("pickInitialAccess prefers intersection then falls back", () => {
    const r1 = pickInitialAccess({
      gapCveIds: ["CVE-1", "CVE-2"],
      actorCveIds: ["CVE-2", "CVE-3"],
      stackTechs: [{ technology: "nginx" }],
    });
    expect(r1.cveId).toBe("CVE-2");

    const r2 = pickInitialAccess({
      gapCveIds: [],
      actorCveIds: ["CVE-X"],
      stackTechs: [],
    });
    expect(r2.cveId).toBe("CVE-X");
  });
});

