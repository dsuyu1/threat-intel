export function toIsoStringSafe(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as never);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
