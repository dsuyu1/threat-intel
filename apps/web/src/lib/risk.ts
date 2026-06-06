export type RiskLevel = "critical" | "high" | "medium" | "low";

export type NavigatorWhyFactor = {
  key?: unknown;
  value?: unknown;
  weight?: unknown;
  contribution?: unknown;
  details?: unknown;
};

export type NavigatorRiskDrivers = {
  actorRelevance: number | null;
  evidenceStrength: number | null;
  stackMatch: number | null;
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function toNumberOrNull(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceJson(value: unknown) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getWhyFactors(whyJson: unknown): NavigatorWhyFactor[] {
  const obj = coerceJson(whyJson) ?? whyJson;
  const raw = (obj as any)?.factors;
  return Array.isArray(raw) ? (raw as NavigatorWhyFactor[]) : [];
}

export function extractNavigatorDrivers(whyJson: unknown): NavigatorRiskDrivers {
  let actorRelevance: number | null = null;
  let evidenceStrength: number | null = null;
  let stackMatch: number | null = null;

  for (const f of getWhyFactors(whyJson)) {
    const key = String(f?.key ?? "");
    const value = toNumberOrNull(f?.value);
    if (value == null) continue;
    if (key === "actor_relevance") actorRelevance = clamp01(value);
    if (key === "relation_strength") evidenceStrength = clamp01(value);
    if (key === "stack_match") stackMatch = clamp01(value);
  }

  return { actorRelevance, evidenceStrength, stackMatch };
}

export function likelihoodFromNavigatorWhy(whyJson: unknown) {
  const factors = getWhyFactors(whyJson);
  if (factors.length) {
    // Prefer the weighted contributions emitted by the engine; sum(contribution) ~= rawPriority in [0,1].
    const contribs = factors.map((f) => toNumberOrNull(f?.contribution)).filter((v): v is number => v != null);
    if (contribs.length) return clamp01(contribs.reduce((a, b) => a + b, 0));
  }

  const d = extractNavigatorDrivers(whyJson);
  const vals = [d.actorRelevance, d.evidenceStrength, d.stackMatch].filter((v): v is number => v != null);
  if (!vals.length) return 0;
  return clamp01(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function impactFromCvssScore(cvssScore: number | null) {
  const v = cvssScore == null ? null : toNumberOrNull(cvssScore);
  if (v == null) return { impact01: 0.55, basis: "No CVSS" };
  return { impact01: clamp01(v / 10), basis: `CVSS ${v.toFixed(1)}` };
}

export function impactFromPrimaryTactic(primaryTactic: string | null) {
  const t = String(primaryTactic ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    impact: 0.9,
    exfiltration: 0.85,
    "credential-access": 0.8,
    "lateral-movement": 0.8,
    "privilege-escalation": 0.75,
    persistence: 0.7,
    "defense-evasion": 0.7,
    execution: 0.65,
    "initial-access": 0.65,
    collection: 0.6,
    "command-and-control": 0.6,
    discovery: 0.55,
    reconnaissance: 0.45,
    "resource-development": 0.45,
  };

  const score = map[t];
  if (score == null) return { impact01: 0.6, basis: "Technique" };
  return { impact01: score, basis: `Tactic: ${t}` };
}

export function riskLevelFromScore(score0to100: number): RiskLevel {
  const s = Number(score0to100 ?? 0);
  if (!Number.isFinite(s)) return "low";
  if (s >= 75) return "critical";
  if (s >= 55) return "high";
  if (s >= 30) return "medium";
  return "low";
}
