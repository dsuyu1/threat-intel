// Minimal ISO2 -> [lng, lat] mapping (capital-city approximations).
// Extend as needed; UI falls back gracefully if unknown.

export const ISO2_COORDS: Record<string, [number, number]> = {
  US: [-77.03, 38.89], // Washington, DC
  RU: [37.62, 55.75], // Moscow
  CN: [116.40, 39.90], // Beijing
  IR: [51.39, 35.69], // Tehran
  KP: [125.73, 39.03], // Pyongyang
  GB: [-0.12, 51.50], // London
  DE: [13.40, 52.52], // Berlin
  IN: [77.21, 28.63], // New Delhi
  BR: [-47.93, -15.78], // Brasília
  UA: [30.52, 50.45], // Kyiv
  IL: [35.21, 31.77], // Jerusalem
};

export function iso2ToLngLat(iso2: string): [number, number] | null {
  const key = iso2.trim().toUpperCase();
  return ISO2_COORDS[key] ?? null;
}

