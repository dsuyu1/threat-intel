import "server-only";

export type SbomFormat = "cyclonedx_json" | "spdx_json" | "unknown";

export type SbomComponent = {
  ref: string;
  name: string;
  version: string | null;
  purl: string | null;
  type: string | null;
};

const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

function asObject(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  return value as any;
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickString(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
}

function extractCveIds(input: unknown): string[] {
  const text = typeof input === "string" ? input : "";
  const matches = text.match(CVE_RE) ?? [];
  return Array.from(new Set(matches.map((m) => m.toUpperCase())));
}

export function detectSbomFormat(doc: unknown): SbomFormat {
  const o = asObject(doc);
  if (!o) return "unknown";
  if (pickString(o.bomFormat)?.toLowerCase() === "cyclonedx") return "cyclonedx_json";
  if (pickString(o.spdxVersion)) return "spdx_json";
  return "unknown";
}

function parseCycloneDxComponents(doc: Record<string, any>): SbomComponent[] {
  const comps = asArray<any>(doc.components);
  const out: SbomComponent[] = [];
  for (const c of comps) {
    const ref = pickString(c?.["bom-ref"]) ?? pickString(c?.bomRef) ?? pickString(c?.purl) ?? pickString(c?.name);
    const name = pickString(c?.name);
    if (!ref || !name) continue;
    out.push({
      ref,
      name,
      version: pickString(c?.version),
      purl: pickString(c?.purl),
      type: pickString(c?.type),
    });
  }
  return out;
}

function parseSpdxComponents(doc: Record<string, any>): SbomComponent[] {
  const pkgs = asArray<any>(doc.packages);
  const out: SbomComponent[] = [];
  for (const p of pkgs) {
    const ref = pickString(p?.SPDXID) ?? pickString(p?.spdxId) ?? pickString(p?.name);
    const name = pickString(p?.name);
    if (!ref || !name) continue;

    const externalRefs = asArray<any>(p.externalRefs);
    const purlRef = externalRefs.find((r) => String(r?.referenceType ?? "").toLowerCase() === "purl");
    const purl = pickString(purlRef?.referenceLocator) ?? pickString(p?.purl);

    out.push({
      ref,
      name,
      version: pickString(p?.versionInfo),
      purl,
      type: pickString(p?.primaryPackagePurpose) ?? pickString(p?.packagePurpose),
    });
  }
  return out;
}

function parseVulns(doc: Record<string, any>) {
  const vulns = asArray<any>(doc.vulnerabilities);
  const cvesByRef = new Map<string, Set<string>>();

  for (const v of vulns) {
    const cves = extractCveIds(v?.id ?? v?.name ?? v?.ref ?? v?.["bom-ref"] ?? "");
    if (!cves.length) continue;

    const affects = asArray<any>(v?.affects);
    const refs = affects
      .map((a) => pickString(a?.ref) ?? pickString(a?.["bom-ref"]) ?? pickString(a?.bomRef))
      .filter((x): x is string => Boolean(x));

    for (const ref of refs) {
      const set = cvesByRef.get(ref) ?? new Set<string>();
      for (const cve of cves) set.add(cve);
      cvesByRef.set(ref, set);
    }
  }

  return cvesByRef;
}

export function analyzeSbom(doc: unknown) {
  const o = asObject(doc);
  if (!o) {
    return {
      format: "unknown" as SbomFormat,
      components: [] as SbomComponent[],
      cvesByComponentRef: new Map<string, Set<string>>(),
    };
  }

  const format = detectSbomFormat(o);
  const components =
    format === "cyclonedx_json"
      ? parseCycloneDxComponents(o)
      : format === "spdx_json"
        ? parseSpdxComponents(o)
        : [];

  // CycloneDX 1.5 has a top-level vulnerabilities[] section. Some SPDX feeds may include it as well.
  const cvesByComponentRef = parseVulns(o);

  return { format, components, cvesByComponentRef };
}

