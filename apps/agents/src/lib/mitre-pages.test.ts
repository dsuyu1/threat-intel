import { describe, expect, it } from "vitest";
import { parseGroupsFromCampaignPage, parseMitreCampaignIndex } from "./mitre-pages.js";

describe("mitre-pages", () => {
  it("parses campaign index with relative links", () => {
    const html = `
      <a href="/campaigns/C0028"> C0028 </a>
      <a href="/campaigns/C0028"> 2015 Ukraine Electric Power Attack </a>
      <a href="/campaigns/C0035"> C0035 </a>
      <a href="/campaigns/C0035"> NotPetya </a>
    `;
    const rows = parseMitreCampaignIndex(html);
    expect(rows.find((r) => r.id === "C0028")?.name).toBe("2015 Ukraine Electric Power Attack");
    expect(rows.find((r) => r.id === "C0035")?.name).toBe("NotPetya");
    expect(rows.find((r) => r.id === "C0028")?.url).toBe("https://attack.mitre.org/campaigns/C0028/");
  });

  it("parses campaign index with absolute links + trailing slash", () => {
    const html = `
      <a href="https://attack.mitre.org/campaigns/C0028/">2015 Ukraine Electric Power Attack</a>
      <a href="https://attack.mitre.org/campaigns/C0035/">NotPetya</a>
    `;
    const rows = parseMitreCampaignIndex(html);
    expect(rows.map((r) => r.id).sort()).toEqual(["C0028", "C0035"]);
  });

  it("parses groups from campaign page (relative and absolute)", () => {
    const html = `
      <a href="/groups/G0034">Sandworm Team</a>
      <a href="https://attack.mitre.org/groups/G0007/">APT28</a>
      <a href="/groups/G0034/">Sandworm Team</a>
    `;
    const ids = parseGroupsFromCampaignPage(html).sort();
    expect(ids).toEqual(["G0007", "G0034"]);
  });
});

