import "server-only";

type StixObject = Record<string, any>;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUuid(hex: string) {
  const h = hex.slice(0, 32).padEnd(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function uuidFromSeed(seed: string) {
  const data = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest).slice(0, 16);
  // RFC4122 v4 + variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return hexToUuid(bytesToHex(bytes));
}

export async function stixId(type: string, seed: string) {
  const uuid = await uuidFromSeed(`${type}:${seed}`);
  return `${type}--${uuid}`;
}

function iso(d: string | Date | null) {
  if (!d) return new Date().toISOString();
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

export function severityFromCvss(score: number | null) {
  if (score == null || !Number.isFinite(score)) return "info";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

export async function buildFindingsBundle(params: {
  now?: Date;
  baseUrl?: string;
  rows: Array<{
    id: string;
    title: string;
    summary: string | null;
    cveId: string | null;
    cvssScore: number | null;
    sourceUrl: string | null;
    publishedAt: string | null;
    createdAt: string | null;
  }>;
}) {
  const now = params.now ?? new Date();

  const objects: StixObject[] = [];
  const vulnIdByCve = new Map<string, string>();

  for (const r of params.rows) {
    const created = iso(r.createdAt ?? now);
    const modified = created;
    const published = iso(r.publishedAt ?? r.createdAt ?? now);

    let vulnRef: string | null = null;
    if (r.cveId) {
      const cve = r.cveId.toUpperCase();
      vulnRef = vulnIdByCve.get(cve) ?? null;
      if (!vulnRef) {
        vulnRef = await stixId("vulnerability", cve);
        vulnIdByCve.set(cve, vulnRef);

        objects.push({
          type: "vulnerability",
          spec_version: "2.1",
          id: vulnRef,
          created,
          modified,
          name: cve,
          description: r.cvssScore != null ? `CVSS ${Number(r.cvssScore).toFixed(1)} (${severityFromCvss(r.cvssScore)})` : undefined,
          external_references: [
            {
              source_name: "cve",
              external_id: cve,
              url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`,
            },
          ],
        });
      }
    }

    const reportId = await stixId("report", r.id);
    const externalRefs = [];
    if (r.sourceUrl) {
      externalRefs.push({
        source_name: "source",
        url: r.sourceUrl,
      });
    }
    if (params.baseUrl) {
      externalRefs.push({
        source_name: "platform",
        url: `${params.baseUrl.replace(/\/+$/, "")}/findings/${encodeURIComponent(r.id)}`,
      });
    }

    objects.push({
      type: "report",
      spec_version: "2.1",
      id: reportId,
      created,
      modified,
      published,
      name: r.title,
      description: r.summary ?? undefined,
      report_types: ["threat-report"],
      object_refs: vulnRef ? [vulnRef] : [],
      external_references: externalRefs.length ? externalRefs : undefined,
    });
  }

  const bundleId = await stixId("bundle", iso(now));
  return { type: "bundle", id: bundleId, objects };
}

export async function buildActorsBundle(params: {
  now?: Date;
  rows: Array<{
    actorId: string;
    name: string;
    aliases: string[] | null;
    description: string | null;
  }>;
}) {
  const now = params.now ?? new Date();
  const created = iso(now);
  const modified = created;

  const objects: StixObject[] = [];
  for (const r of params.rows) {
    const id = await stixId("threat-actor", r.actorId);
    objects.push({
      type: "threat-actor",
      spec_version: "2.1",
      id,
      created,
      modified,
      name: r.name,
      description: r.description ?? undefined,
      aliases: (r.aliases ?? []).filter(Boolean),
    });
  }

  const bundleId = await stixId("bundle", `actors:${iso(now)}`);
  return { type: "bundle", id: bundleId, objects };
}
