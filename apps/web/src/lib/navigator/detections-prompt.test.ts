import { describe, expect, it } from "vitest";

import { buildNavigatorDetectionPromptFromContext, stripCodeFences } from "@ti/db";

describe("Navigator detection prompt builder", () => {
  it("includes Sigma constraints and ATT&CK tag requirement", () => {
    const prompt = buildNavigatorDetectionPromptFromContext({
      format: "sigma",
      sigmaRuleId: "00000000-0000-0000-0000-000000000000",
      date: "2026-06-07",
      scenarioTitle: "Example scenario",
      scenarioSummary: "Example summary",
      actorId: "G0000",
      actorName: "Example actor",
      primaryTactic: "execution",
      techniqueId: "T1059",
      techniqueName: "Command and Scripting Interpreter",
      techniqueDescription: "Test technique description",
      evidence: [{ url: "https://example.com", excerpt: "Example evidence excerpt" }],
    });

    expect(prompt).toContain("Generate ONE Sigma rule YAML.");
    expect(prompt).toContain("Tags MUST include the MITRE technique id");
    expect(prompt).toContain("attack.t1059");
    expect(prompt).toContain("Use this id: 00000000-0000-0000-0000-000000000000");
    expect(prompt).toContain("Set date to 2026-06-07");
  });

  it("includes Sentinel KQL constraints", () => {
    const prompt = buildNavigatorDetectionPromptFromContext({
      format: "kql",
      sigmaRuleId: "00000000-0000-0000-0000-000000000000",
      date: "2026-06-07",
      scenarioTitle: "Example scenario",
      scenarioSummary: null,
      actorId: "G0000",
      actorName: null,
      primaryTactic: null,
      techniqueId: "T1059",
      techniqueName: "Command and Scripting Interpreter",
      techniqueDescription: null,
      evidence: [],
    });

    expect(prompt).toContain("Generate a Microsoft Sentinel KQL query.");
    expect(prompt).toContain("Output raw KQL only.");
    expect(prompt).toContain("Include a short comment header (//)");
  });

  it("includes Splunk SPL constraints", () => {
    const prompt = buildNavigatorDetectionPromptFromContext({
      format: "spl",
      sigmaRuleId: "00000000-0000-0000-0000-000000000000",
      date: "2026-06-07",
      scenarioTitle: "Example scenario",
      scenarioSummary: null,
      actorId: "G0000",
      actorName: null,
      primaryTactic: null,
      techniqueId: "T1059",
      techniqueName: "Command and Scripting Interpreter",
      techniqueDescription: null,
      evidence: [],
    });

    expect(prompt).toContain("Generate a Splunk SPL query.");
    expect(prompt).toContain("Output raw SPL only");
    expect(prompt).toContain("<INDEX>");
  });
});

describe("stripCodeFences", () => {
  it("removes markdown code fences", () => {
    expect(stripCodeFences("```spl\nindex=main | stats count\n```")).toBe("index=main | stats count");
    expect(stripCodeFences("index=main")).toBe("index=main");
  });
});

