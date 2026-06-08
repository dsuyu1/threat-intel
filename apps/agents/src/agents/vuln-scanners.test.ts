import { describe, expect, it } from "vitest";

import { normalizeCveId, normalizeStatus, openvasExtract, parseDateLike, qualysExtract, tenableExtract } from "./vuln-scanners";

describe("vuln-scanners helpers", () => {
  it("normalizes CVE IDs", () => {
    expect(normalizeCveId("cve-2024-1234")).toBe("CVE-2024-1234");
    expect(normalizeCveId("junk CVE-2023-0001 trailing")).toBe("CVE-2023-0001");
    expect(normalizeCveId("nope")).toBe(null);
  });

  it("normalizes statuses across vendors", () => {
    expect(normalizeStatus("OPEN")).toBe("open");
    expect(normalizeStatus("reopened")).toBe("open");
    expect(normalizeStatus("ACTIVE")).toBe("open");
    expect(normalizeStatus("FIXED")).toBe("fixed");
    expect(normalizeStatus("remediated")).toBe("fixed");
    expect(normalizeStatus("")).toBe("unknown");
  });

  it("parses date-like values (seconds vs ms)", () => {
    const s = parseDateLike(1_710_000_000)!; // seconds
    expect(s.getUTCFullYear()).toBeGreaterThanOrEqual(2023);

    const ms = parseDateLike(1_710_000_000_000)!; // ms
    expect(ms.getUTCFullYear()).toBeGreaterThanOrEqual(2023);

    expect(parseDateLike("not-a-date")).toBe(null);
  });
});

describe("vuln-scanners extraction", () => {
  it("extracts Tenable export records into asset + CVE edges", () => {
    const records = [
      {
        asset: { uuid: "a-1", hostname: "host1", ipv4: "10.0.0.1", operating_system: ["Windows"] },
        plugin: { id: 123, cve: ["CVE-2024-1234", "cve-2023-0001"] },
        state: "OPEN",
        first_found: 1_710_000_000,
        last_found: 1_711_000_000,
        severity: "high",
      },
      {
        asset: { uuid: "a-1", hostname: "host1", ipv4: "10.0.0.1" },
        plugin: { id: 123, cve: ["CVE-2024-1234"] },
        state: "FIXED",
        last_found: 1_712_000_000,
      },
    ];

    const out = tenableExtract(records);
    expect(out.assets.size).toBe(1);
    expect(out.touchedCveIds.has("CVE-2024-1234")).toBe(true);
    expect(out.touchedCveIds.has("CVE-2023-0001")).toBe(true);
    expect(out.assetCves.size).toBe(2);

    const edge = Array.from(out.assetCves.values()).find((e) => e.cveId === "CVE-2024-1234");
    expect(edge?.status).toBeTruthy();
    expect(edge?.lastSeenAt).toBeInstanceOf(Date);
  });

  it("extracts Qualys host detections XML (best-effort)", () => {
    const xml = `
      <HOST_LIST>
        <HOST>
          <ID>1001</ID>
          <IP>192.0.2.10</IP>
          <DNS>web01.example.com</DNS>
          <OS>Linux</OS>
          <DETECTION_LIST>
            <DETECTION>
              <QID>12345</QID>
              <STATUS>ACTIVE</STATUS>
              <SEVERITY>4</SEVERITY>
              <FIRST_FOUND_DATETIME>2026-06-01T00:00:00Z</FIRST_FOUND_DATETIME>
              <LAST_FOUND_DATETIME>2026-06-07T00:00:00Z</LAST_FOUND_DATETIME>
              <CVE_ID_LIST>
                <CVE_ID>CVE-2024-9999</CVE_ID>
              </CVE_ID_LIST>
            </DETECTION>
          </DETECTION_LIST>
        </HOST>
      </HOST_LIST>
    `;

    const out = qualysExtract(xml);
    expect(out.assets.size).toBe(1);
    expect(out.touchedCveIds.has("CVE-2024-9999")).toBe(true);
    expect(out.assetCves.size).toBe(1);
  });

  it("extracts OpenVAS/GSA GMP results XML (best-effort)", () => {
    const xml = `
      <get_results_response status="200" status_text="OK">
        <results>
          <result id="r-1">
            <creation_time>2026-06-07T00:00:00Z</creation_time>
            <host>192.0.2.10</host>
            <severity>7.5</severity>
            <nvt oid="1.3.6.1.4.1.25623.1.0.12345">
              <name>Example vuln</name>
              <refs>
                <ref type="cve" id="CVE-2024-9999" />
              </refs>
            </nvt>
          </result>
        </results>
      </get_results_response>
    `;

    const out = openvasExtract(xml, { since: new Date("2026-06-01T00:00:00Z") });
    expect(out.assets.size).toBe(1);
    expect(out.touchedCveIds.has("CVE-2024-9999")).toBe(true);
    expect(out.assetCves.size).toBe(1);
  });
});
