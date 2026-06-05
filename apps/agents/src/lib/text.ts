import { htmlToText } from "html-to-text";

export function cleanHtmlToText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  })
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlapChars?: number; maxChunks?: number }
): Array<{ index: number; text: string }> {
  const maxChars = opts?.maxChars ?? 1400;
  const overlapChars = opts?.overlapChars ?? 200;
  const maxChunks = opts?.maxChunks ?? 12;

  const chunks: Array<{ index: number; text: string }> = [];
  let start = 0;
  let index = 0;

  while (start < text.length && chunks.length < maxChunks) {
    const end = Math.min(text.length, start + maxChars);
    const slice = text.slice(start, end).trim();
    if (slice) chunks.push({ index, text: slice });
    index++;
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

