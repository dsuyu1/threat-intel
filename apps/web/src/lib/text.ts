const REPLACEMENTS: Array<[from: string, to: string]> = [
  // Common UTF-8 -> Latin-1 mojibake
  ["â€”", "\u2014"], // em dash
  ["Ã¢â‚¬â€", "\u2014"], // em dash (variant)
  ["â€“", "\u2013"], // en dash
  ["Ã¢â‚¬â€œ", "\u2013"], // en dash (variant)
  ["â€¦", "\u2026"], // ellipsis
  ["Ã¢â‚¬Â¦", "\u2026"], // ellipsis (variant)
  ["â€˜", "\u2018"], // left single quote
  ["â€™", "\u2019"], // right single quote
  ["Ã¢â‚¬â„¢", "\u2019"], // right single quote (variant)
  ["â€œ", "\u201C"], // left double quote
  ["â€", "\u201D"], // right double quote
  ["Ã¢â‚¬Å“", "\u201C"], // left double quote (variant)
  ["Ã¢â‚¬Â", "\u201D"], // right double quote (variant)

  // Arrows / symbols
  ["â†", "\u2190"], // left arrow
  ["Ã¢â€ Â", "\u2190"], // left arrow (variant)
  ["â†—", "\u2197"], // north east arrow
  ["Ã¢â€ â€”", "\u2197"], // north east arrow (variant)

  // Non-breaking spaces rendered as "Â"
  ["\u00C2\u00A0", " "],
  ["Â ", " "],
];

export function fixText(input: string | null | undefined): string {
  if (input == null) return "";
  let out = String(input);
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
  return out;
}

