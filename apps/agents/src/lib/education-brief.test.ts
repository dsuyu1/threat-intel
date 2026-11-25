import { describe, expect, it } from "vitest";
import { createEducationBrief, parseEducationEntries } from "./education-brief.js";

const sourceUrl = "https://example.org/advisory";
const base = {
  id: "exercise-001",
  date: "2026-11-18",
  title: "Campus identity exercise",
  summary: "Fictional account takeover",
  action: "review sign-ins",
  owner: "Identity team",
  audiences: ["higher-ed"],
  coverage: "reported-targeting",
  topic: "identity",
  priority: "check-exposure",
  sources: [sourceUrl],
  status: "approved",
  sharing: "public",
};

const indicator = { kind: "domain", value: "LOGIN.EXAMPLE", validThrough: "2026-11-18", confidence: "high", sourceUrl };
const ledger = (...records: object[]) => parseEducationEntries(records.map((record) => JSON.stringify(record)).join("\n"));

describe("education brief", () => {
  it("excludes draft and restricted records from all generated files", () => {
    const entries = ledger(base,
      { ...base, id: "draft", title: "draft marker", status: "draft", indicators: [indicator] },
      { ...base, id: "restricted", title: "restricted marker", sharing: "restricted", indicators: [indicator] },
    );
    const files = createEducationBrief(entries, base.date, true);
    const contents = Object.values(files).join("\n");

    expect(contents).toContain("Campus identity exercise");
    expect(contents).not.toMatch(/draft marker|restricted marker|login\.example/);
    expect(files["newsletter-draft.md"]).toContain("Campus identity exercise");
    expect(createEducationBrief(entries, base.date)).not.toHaveProperty("newsletter-draft.md");
  });

  it("counts only documented targeting and carries cited indicators through their review date", () => {
    const entries = ledger(
      { ...base, indicators: [indicator, indicator, { ...indicator, value: "stale.example", validThrough: "2026-11-17" }], date: "2026-11-11" },
      { ...base, id: "exercise-002", coverage: "technology-exposure", audiences: ["higher-ed", "k-12"] },
      { ...base, id: "future", date: "2026-11-19", title: "future marker" },
    );
    const files = createEducationBrief(entries, base.date);
    const report = files["report.md"]!;
    const csv = files["iocs.csv"]!;

    expect(report).toContain("| Higher ed | identity | 0 | 1 |");
    expect(report).toContain("Education technology exposure");
    expect(report).not.toContain("future marker");
    expect(csv.match(/login\.example/g)).toHaveLength(1);
    expect(csv).toContain(sourceUrl);
    expect(csv).not.toContain("stale.example");
    expect(files["blog-draft.md"]).not.toContain("login.example");
  });

  it("rejects unlisted evidence URLs, duplicate stable IDs, and invalid dates", () => {
    expect(() => ledger({ ...base, indicators: [{ ...indicator, sourceUrl: "https://example.org/uncited" }] }))
      .toThrow("indicator.sourceUrl must also appear in sources");
    expect(() => ledger(base, base)).toThrow("Duplicate approved entry ID");
    expect(() => ledger({ ...base, date: "2026-02-30" })).toThrow("real UTC date");
  });
});
