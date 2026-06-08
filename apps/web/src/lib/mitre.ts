const MITRE_TECHNIQUE_ID_RE = /^T\d{4}(?:\.\d{3})?$/i;

export function normalizeMitreTechniqueId(value: unknown) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (!MITRE_TECHNIQUE_ID_RE.test(v)) return "";
  return v.toUpperCase();
}

export function csvContainsMitreTechniqueId(csv: string | null, mitreId: string) {
  const id = normalizeMitreTechniqueId(mitreId);
  if (!id) return false;
  const hay = `,${String(csv ?? "").toUpperCase()},`;
  return hay.includes(`,${id},`);
}

