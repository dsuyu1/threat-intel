import { describe, expect, it } from "vitest";
import { extractCustomFieldValue, mapTheHiveCaseToIncident, normalizeIncidentType, parseTheHiveTimestamp } from "./thehive";

describe("parseTheHiveTimestamp", () => {
  it("parses epoch milliseconds", () => {
    const d = parseTheHiveTimestamp(1_700_000_000_000);
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString().startsWith("2023")).toBe(true);
  });

  it("parses epoch seconds", () => {
    const d = parseTheHiveTimestamp(1_700_000_000);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(1_700_000_000_000);
  });

  it("parses ISO string", () => {
    const d = parseTheHiveTimestamp("2026-06-07T12:00:00Z");
    expect(d?.toISOString()).toBe("2026-06-07T12:00:00.000Z");
  });
});

describe("extractCustomFieldValue", () => {
  it("extracts direct value", () => {
    expect(extractCustomFieldValue({ ti_incident_type: "ransomware" }, "ti_incident_type")).toBe("ransomware");
  });

  it("extracts nested value", () => {
    expect(extractCustomFieldValue({ ti_incident_type: { value: "ransomware" } }, "ti_incident_type")).toBe("ransomware");
    expect(extractCustomFieldValue({ ti_incident_type: { string: "ransomware" } }, "ti_incident_type")).toBe("ransomware");
  });

  it("extracts nested date", () => {
    expect(extractCustomFieldValue({ ti_responded_at: { date: 1_700_000_000_000 } }, "ti_responded_at")).toBe(1_700_000_000_000);
  });
});

describe("normalizeIncidentType", () => {
  it("accepts known types", () => {
    expect(normalizeIncidentType("ransomware")).toBe("ransomware");
    expect(normalizeIncidentType("  DATA_EXFILTRATION ")).toBe("data_exfiltration");
  });

  it("rejects unknown types", () => {
    expect(normalizeIncidentType("other")).toBe(null);
  });
});

describe("mapTheHiveCaseToIncident", () => {
  it("maps common fields + custom fields", () => {
    const out = mapTheHiveCaseToIncident({
      _id: "case-123",
      number: 42,
      title: "Example",
      status: "Resolved",
      startDate: 1_700_000_000_000,
      _createdAt: 1_700_000_100_000,
      _updatedAt: 1_700_000_200_000,
      customFields: {
        ti_incident_type: { value: "ransomware" },
        ti_responded_at: { date: 1_700_000_120_000 },
        ti_contained_at: { date: 1_700_000_180_000 },
      },
    });

    expect(out?.externalId).toBe("case-123");
    expect(out?.externalNumber).toBe(42);
    expect(out?.incidentType).toBe("ransomware");
    expect(out?.startedAt?.getTime()).toBe(1_700_000_000_000);
    expect(out?.detectedAt?.getTime()).toBe(1_700_000_100_000);
    expect(out?.respondedAt?.getTime()).toBe(1_700_000_120_000);
    expect(out?.containedAt?.getTime()).toBe(1_700_000_180_000);
    expect(out?.externalUpdatedAt?.getTime()).toBe(1_700_000_200_000);
  });
});
