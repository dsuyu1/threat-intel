export const SECTORS = [
  "finance",
  "healthcare",
  "government",
  "education",
  "energy",
  "telecom",
  "defense",
  "retail",
  "manufacturing",
  "technology",
  "transportation",
  "critical-infrastructure",
] as const;

export type Sector = (typeof SECTORS)[number];

export function isSector(x: string): x is Sector {
  return (SECTORS as readonly string[]).includes(x);
}

const SECTOR_ALIASES: Record<string, Sector> = {
  "health-care": "healthcare",
  "health-care-and-life-sciences": "healthcare",
  "health-and-life-sciences": "healthcare",
  "financial": "finance",
  "financial-services": "finance",
  "public-sector": "government",
  "gov": "government",
  "govt": "government",
  "telecommunications": "telecom",
  "telecommunications-and-media": "telecom",
  "defence": "defense",
  "it": "technology",
  "tech": "technology",
  "transport": "transportation",
  "industrial": "manufacturing",
  "industry": "manufacturing",
  "utilities": "energy",
};

export function normalizeSector(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function resolveSector(raw: string): Sector | null {
  const normalized = normalizeSector(raw);
  if (!normalized) return null;
  if (isSector(normalized)) return normalized;
  return SECTOR_ALIASES[normalized] ?? null;
}

