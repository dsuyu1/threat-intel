export type StackMatchKind = "match" | "no-match" | "unknown-match";

export function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function normalizeTechString(input: string) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string) {
  const ta = new Set(normalizeTechString(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTechString(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

export function classifyKevStackMatch(params: {
  userStack: string[];
  kevVendorProject?: string | null;
  kevProduct?: string | null;
}): { kind: StackMatchKind; matchedTechnology: string | null; matchedOn: "vendorProject" | "product" | null } {
  const vendor = String(params.kevVendorProject ?? "").trim();
  const product = String(params.kevProduct ?? "").trim();
  const hasKev = !!(vendor || product);
  if (!hasKev) return { kind: "unknown-match", matchedTechnology: null, matchedOn: null };

  const stack = (params.userStack ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (stack.length === 0) return { kind: "no-match", matchedTechnology: null, matchedOn: null };

  // Heuristic: prefer strong substring matches; fall back to token overlap.
  const vendorNorm = normalizeTechString(vendor);
  const productNorm = normalizeTechString(product);

  const matchAgainst = (needleNorm: string, on: "vendorProject" | "product") => {
    if (!needleNorm) return null;
    for (const tech of stack) {
      const techNorm = normalizeTechString(tech);
      if (!techNorm) continue;
      if (techNorm.includes(needleNorm) || needleNorm.includes(techNorm)) {
        return { tech, on };
      }
      if (tokenOverlapScore(techNorm, needleNorm) >= 0.6) {
        return { tech, on };
      }
    }
    return null;
  };

  const hitVendor = matchAgainst(vendorNorm, "vendorProject");
  if (hitVendor) return { kind: "match", matchedTechnology: hitVendor.tech, matchedOn: hitVendor.on };

  const hitProduct = matchAgainst(productNorm, "product");
  if (hitProduct) return { kind: "match", matchedTechnology: hitProduct.tech, matchedOn: hitProduct.on };

  return { kind: "no-match", matchedTechnology: null, matchedOn: null };
}

export function stackMatchScore(kind: StackMatchKind) {
  if (kind === "match") return 1;
  if (kind === "unknown-match") return 0.35;
  return 0.2;
}

export function relationStrength(params: { support: number; confidence: number }) {
  const s = Math.max(0, Number(params.support ?? 0));
  const c = Math.max(0, Number(params.confidence ?? 0));
  // support is already time-decayed upstream. tanh keeps it bounded + explainable.
  return clamp01(Math.tanh(s * c));
}

export function recencyScore(params: { lastSeen: Date | string | null; now?: Date }) {
  const now = params.now ?? new Date();
  const d =
    params.lastSeen instanceof Date ? params.lastSeen : params.lastSeen ? new Date(params.lastSeen) : null;
  const days = d && Number.isFinite(d.getTime()) ? Math.max(0, (now.getTime() - d.getTime()) / 86_400_000) : null;
  if (days === null) return { days: null, score: 0.25 };
  // ~0.5 at 30 days; ~0.25 at 90 days
  return { days, score: clamp01(1 / (1 + days / 30)) };
}

export type WeightedFactor = {
  key: "actor_relevance" | "relation_strength" | "stack_match";
  value: number;
  weight: number;
  contribution: number;
  details?: unknown;
};

export function topFactors(factors: WeightedFactor[], topN = 3) {
  return factors
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, Math.max(1, topN));
}

export function assignPercentileScores<T extends { rawPriority: number; scenarioKey: string }>(items: T[]) {
  const sorted = items
    .slice()
    .sort((a, b) => (a.rawPriority === b.rawPriority ? a.scenarioKey.localeCompare(b.scenarioKey) : a.rawPriority - b.rawPriority));

  const n = sorted.length;
  const scoreByKey = new Map<string, number>();
  if (n === 0) return scoreByKey;
  if (n === 1) {
    scoreByKey.set(sorted[0]!.scenarioKey, 100);
    return scoreByKey;
  }

  let i = 0;
  while (i < n) {
    const start = i;
    const v = sorted[i]!.rawPriority;
    while (i < n && sorted[i]!.rawPriority === v) i++;
    const end = i - 1;
    const avgIdx = (start + end) / 2;
    const pct = Math.round((avgIdx / (n - 1)) * 100);
    for (let j = start; j <= end; j++) scoreByKey.set(sorted[j]!.scenarioKey, pct);
  }

  return scoreByKey;
}

