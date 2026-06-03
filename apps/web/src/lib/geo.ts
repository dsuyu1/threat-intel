/**
 * geo.ts — assigns [longitude, latitude] coordinates to findings.
 *
 * Coordinates are derived from:
 * 1. Known APT group → country of origin
 * 2. Tags containing country names
 * 3. Sector defaults (energy → Middle East, finance → NYC, etc.)
 * 4. Random scatter within a region as fallback
 *
 * This is attribution-based placement, not a claim of exact location.
 */

// Known APT groups → country coords (capital city approximation)
const APT_COORDS: Record<string, [number, number]> = {
  // China
  "apt1":   [121.47, 31.23],
  "apt10":  [116.40, 39.90],
  "apt41":  [116.40, 39.90],
  "apt40":  [110.35, 20.02],
  "apt31":  [116.40, 39.90],
  "unc215": [116.40, 39.90],
  // Russia
  "apt28":  [37.62, 55.75],
  "apt29":  [37.62, 55.75],
  "cozy bear":   [37.62, 55.75],
  "fancy bear":  [37.62, 55.75],
  "sandworm":    [37.62, 55.75],
  "turla":       [37.62, 55.75],
  "gamaredon":   [30.52, 50.45],
  // North Korea
  "lazarus": [125.73, 39.03],
  "apt38":   [125.73, 39.03],
  "kimsuky": [125.73, 39.03],
  "bluenoroff": [125.73, 39.03],
  // Iran
  "apt33":   [51.39, 35.69],
  "apt34":   [51.39, 35.69],
  "apt35":   [51.39, 35.69],
  "charming kitten": [51.39, 35.69],
  "phosphorus": [51.39, 35.69],
  // USA (vulnerability research / CISA)
  "cisa":    [-77.03, 38.89],
  // Generic / unknown
  "scattered spider": [-118.24, 34.05], // attributed to Western actors
};

// Country name → coords
const COUNTRY_COORDS: Record<string, [number, number]> = {
  china:         [116.40, 39.90],
  russia:        [37.62, 55.75],
  "north korea": [125.73, 39.03],
  iran:          [51.39, 35.69],
  usa:           [-77.03, 38.89],
  "united states": [-77.03, 38.89],
  ukraine:       [30.52, 50.45],
  israel:        [35.21, 31.77],
  india:         [77.21, 28.63],
  germany:       [13.40, 52.52],
  "united kingdom": [-0.12, 51.50],
  uk:            [-0.12, 51.50],
  brazil:        [-47.93, -15.78],
};

// Sector → typical targeting region coords (where attacks land, not origin)
const SECTOR_COORDS: Record<string, [number, number]> = {
  energy:     [46.68, 24.68],  // Saudi Arabia / Middle East energy
  finance:    [-74.00, 40.71], // New York
  healthcare: [-87.63, 41.88], // Chicago
  government: [-77.03, 38.89], // Washington DC
  defense:    [-77.03, 38.89],
  telecom:    [103.82, 1.35],  // Singapore
  crypto:     [-122.43, 37.77], // San Francisco
};

// Slight random jitter so overlapping dots don't stack exactly
function jitter(base: [number, number], amount = 2): [number, number] {
  return [
    base[0] + (Math.random() - 0.5) * amount,
    base[1] + (Math.random() - 0.5) * amount,
  ];
}

export function inferCoords(
  tags: string | null,
  agent: string
): [number, number] {
  const tagList: string[] = (() => {
    try { return tags ? JSON.parse(tags) : []; }
    catch { return []; }
  })();

  const lower = tagList.map((t) => t.toLowerCase());

  // 1. Check for known APT name in tags
  for (const tag of lower) {
    for (const [apt, coords] of Object.entries(APT_COORDS)) {
      if (tag.includes(apt)) return jitter(coords);
    }
  }

  // 2. Check for country name in tags
  for (const tag of lower) {
    for (const [country, coords] of Object.entries(COUNTRY_COORDS)) {
      if (tag.includes(country)) return jitter(coords);
    }
  }

  // 3. Check for sector in tags
  for (const tag of lower) {
    for (const [sector, coords] of Object.entries(SECTOR_COORDS)) {
      if (tag.includes(sector)) return jitter(coords);
    }
  }

  // 4. Agent-based fallback with global scatter
  const fallbacks: Record<string, [number, number][]> = {
    vuln:    [[-77.03, 38.89], [116.40, 39.90], [37.62, 55.75]],
    attack:  [[37.62, 55.75], [116.40, 39.90], [125.73, 39.03]],
    exploit: [[-74.00, 40.71], [116.40, 39.90], [37.62, 55.75]],
    ttp:     [[116.40, 39.90], [37.62, 55.75], [51.39, 35.69]],
    malware: [[37.62, 55.75], [116.40, 39.90], [125.73, 39.03]],
  };

  const options = fallbacks[agent] ?? fallbacks["vuln"]!;
  const base = options[Math.floor(Math.random() * options.length)]!;
  return jitter(base, 8);
}
