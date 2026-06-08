export const INCIDENT_TYPES = [
  "vulnerability_exploitation",
  "credential_compromise",
  "ransomware",
  "supply_chain",
  "lateral_movement",
  "data_exfiltration",
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

const INCIDENT_TYPE_SET = new Set<string>(INCIDENT_TYPES);

export function normalizeIncidentType(value: unknown): IncidentType | null {
  const v = String(value ?? "").trim().toLowerCase();
  return INCIDENT_TYPE_SET.has(v) ? (v as IncidentType) : null;
}

export function parseTheHiveTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const n = value;
    // Heuristic: seconds vs milliseconds.
    const ms = n >= 10_000_000_000 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  // Numeric string timestamp?
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return parseTheHiveTimestamp(n);
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function extractCustomFieldValue(customFields: unknown, key: string): unknown {
  if (!customFields || typeof customFields !== "object") return null;
  const cf = customFields as Record<string, unknown>;

  const raw =
    cf[key] ??
    cf[key.toLowerCase()] ??
    cf[key.toUpperCase()] ??
    cf[key.replace(/-/g, "_")] ??
    cf[key.replace(/_/g, "-")];

  if (raw == null) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;

  if (Array.isArray(raw)) return raw.length ? raw[0] : null;

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const candidates = [
      o.value,
      o.string,
      o.text,
      o.number,
      o.boolean,
      o.date,
      o.datetime,
      o.timestamp,
      o.long,
      o.int,
      o.integer,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      if (typeof c === "string" || typeof c === "number" || typeof c === "boolean") return c;
      if (Array.isArray(c)) return c.length ? c[0] : null;
    }
  }

  return null;
}

export function mapTheHiveCaseToIncident(input: unknown): {
  externalId: string;
  externalNumber: number | null;
  title: string | null;
  status: string | null;
  incidentType: IncidentType | null;
  startedAt: Date | null;
  detectedAt: Date | null;
  respondedAt: Date | null;
  containedAt: Date | null;
  closedAt: Date | null;
  externalUpdatedAt: Date | null;
  rawJson: unknown;
} | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;

  const externalId = String((c._id ?? c.id ?? c.caseId ?? "") as any).trim();
  if (!externalId) return null;

  const numRaw = c.number ?? c.caseNumber ?? null;
  const externalNumber =
    typeof numRaw === "number"
      ? Number.isFinite(numRaw)
        ? Math.trunc(numRaw)
        : null
      : typeof numRaw === "string" && numRaw.trim()
        ? Number.isFinite(Number(numRaw))
          ? Math.trunc(Number(numRaw))
          : null
        : null;

  const title = c.title != null ? String(c.title) : c.name != null ? String(c.name) : null;
  const status = c.status != null ? String(c.status) : null;

  const customFields = (c.customFields ?? c.custom_fields ?? null) as any;
  const incidentType = normalizeIncidentType(extractCustomFieldValue(customFields, "ti_incident_type"));

  const startedAt = parseTheHiveTimestamp(c.startDate ?? c.start_date ?? null);
  const detectedAt = parseTheHiveTimestamp(c.createdAt ?? c._createdAt ?? c.created_at ?? null);
  const externalUpdatedAt = parseTheHiveTimestamp(c.updatedAt ?? c._updatedAt ?? c.updated_at ?? null);
  const closedAt = parseTheHiveTimestamp(
    c.endDate ?? c.end_date ?? c.closedAt ?? c.closed_at ?? c.resolvedAt ?? c.resolved_at ?? null
  );

  const respondedAt = parseTheHiveTimestamp(extractCustomFieldValue(customFields, "ti_responded_at"));
  const containedAt = parseTheHiveTimestamp(extractCustomFieldValue(customFields, "ti_contained_at"));

  return {
    externalId,
    externalNumber,
    title: title ? title.trim().slice(0, 500) : null,
    status: status ? status.trim().slice(0, 120) : null,
    incidentType,
    startedAt,
    detectedAt,
    respondedAt,
    containedAt,
    closedAt,
    externalUpdatedAt,
    rawJson: input,
  };
}

