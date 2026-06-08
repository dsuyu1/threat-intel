import { describe, expect, test } from "vitest";
import { parseD3fendMitigationMappings, parseD3fendTechniquesCsv } from "./ttp";

describe("TtpAgent D3FEND parsing", () => {
  test("parseD3fendTechniquesCsv extracts id/name/description/category", () => {
    const csv = [
      'id,label,definition,category',
      'D3-LFP,"Local File Permissions","Limit access to local files","Isolate"',
      'D3-NM,"Network Mapping","Map network connections","Detect"',
    ].join("\n");

    const map = parseD3fendTechniquesCsv(csv);
    expect(map.get("D3-LFP")?.name).toBe("Local File Permissions");
    expect(map.get("D3-LFP")?.description).toBe("Limit access to local files");
    expect(map.get("D3-LFP")?.category).toBe("Isolate");
  });

  test("parseD3fendMitigationMappings parses JSON rows", () => {
    const payload = JSON.stringify([
      { attack_mitigation: "M1040", d3fend: ["D3-LFP", "D3-NM"] },
      { mitigation: "M1050", technique: "D3-NM" },
    ]);

    const rows = parseD3fendMitigationMappings(payload);
    expect(rows).toEqual([
      { mitigationId: "M1040", d3fendIds: ["D3-LFP", "D3-NM"] },
      { mitigationId: "M1050", d3fendIds: ["D3-NM"] },
    ]);
  });

  test("parseD3fendMitigationMappings parses HTML fallback table", () => {
    const html = `
      <table>
        <tr><th>Mitigation</th><th>D3FEND</th></tr>
        <tr><td>M1040</td><td><a>D3-LFP</a> <a>D3-NM</a></td></tr>
        <tr><td>M1050</td><td>D3-NM</td></tr>
      </table>
    `;

    const rows = parseD3fendMitigationMappings(html);
    expect(rows).toEqual([
      { mitigationId: "M1040", d3fendIds: ["D3-LFP", "D3-NM"] },
      { mitigationId: "M1050", d3fendIds: ["D3-NM"] },
    ]);
  });
});

