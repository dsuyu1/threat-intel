const REPLACEMENTS: Array<[from: string, to: string]> = [
  // Common UTF-8 -> Windows-1252/Latin-1 mojibake
  ["â€”", "\u2014"], // em dash
  ["\u00e2\u0080\u0094", "\u2014"], // em dash (â)
  ["Ã¢â‚¬â€", "\u2014"], // em dash (double-mojibake variant)
  ["â€“", "\u2013"], // en dash
  ["\u00e2\u0080\u0093", "\u2013"], // en dash (â)
  ["Ã¢â‚¬â€œ", "\u2013"], // en dash (double-mojibake variant)
  ["â€¦", "\u2026"], // ellipsis
  ["\u00e2\u0080\u00a6", "\u2026"], // ellipsis (â¦)
  ["Ã¢â‚¬Â¦", "\u2026"], // ellipsis (double-mojibake variant)
  ["â€˜", "\u2018"], // left single quote
  ["\u00e2\u0080\u0098", "\u2018"], // left single quote (â)
  ["â€™", "\u2019"], // right single quote
  ["\u00e2\u0080\u0099", "\u2019"], // right single quote (â)
  ["Ã¢â‚¬â„¢", "\u2019"], // right single quote (double-mojibake variant)
  ["â€œ", "\u201C"], // left double quote
  ["\u00e2\u0080\u009c", "\u201C"], // left double quote (â)
  ["â€", "\u201D"], // right double quote
  ["\u00e2\u0080\u009d", "\u201D"], // right double quote (â)
  ["Ã¢â‚¬Å“", "\u201C"], // left double quote (double-mojibake variant)
  ["Ã¢â‚¬Â", "\u201D"], // right double quote (double-mojibake variant)

  // Bullets
  ["â€¢", "\u2022"], // bullet
  ["\u00e2\u0080\u00a2", "\u2022"], // bullet (â¢)
  ["Ã¢â‚¬Â¢", "\u2022"], // bullet (double-mojibake variant)

  // Arrows / symbols
  ["â†", "\u2190"], // left arrow
  ["\u00e2\u0086\u0090", "\u2190"], // left arrow (â)
  ["Ã¢â€ Â", "\u2190"], // left arrow (double-mojibake variant)
  ["â†’", "\u2192"], // right arrow
  ["\u00e2\u0086\u0092", "\u2192"], // right arrow (â)
  ["â†—", "\u2197"], // north east arrow
  ["\u00e2\u0086\u0097", "\u2197"], // north east arrow (â)
  ["Ã¢â€ â€”", "\u2197"], // north east arrow (double-mojibake variant)

  // Non-breaking spaces rendered as "Â"
  ["\u00C2\u00A0", " "],
  ["Â ", " "],
];

function applyReplacements(input: string): string {
  let out = input;
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
  return out;
}

function decodeUtf8FromLatin1Maybe(input: string): string {
  // Heuristic: fix strings that look like UTF-8 bytes interpreted as Latin-1 (e.g. "CÃ´te d'Ivoire").
  // We intentionally *don't* try to decode sequences containing characters like "€" or "™" because those
  // require a Windows-1252 mapping (and are already handled by REPLACEMENTS above).
  if (!/(?:Ã|Â)/.test(input)) return input;

  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code > 0xff) return input;
    bytes[i] = code;
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (decoded.includes("\uFFFD")) return input;

  const score = (s: string) => (s.match(/[ÃÂ]/g)?.length ?? 0);
  return score(decoded) < score(input) ? decoded : input;
}

export function fixText(input: string | null | undefined): string {
  if (input == null) return "";
  const asString = String(input);
  const once = applyReplacements(asString);
  const decoded = decodeUtf8FromLatin1Maybe(once);
  return decoded === once ? once : applyReplacements(decoded);
}
