import { KqlError } from "./errors";

export type Token =
  | { kind: "identifier"; value: string; pos: number }
  | { kind: "number"; value: number; raw: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "op"; value: "==" | "!=" | ">=" | "<=" | ">" | "<" | "="; pos: number }
  | { kind: "pipe"; pos: number }
  | { kind: "comma"; pos: number }
  | { kind: "lparen"; pos: number }
  | { kind: "rparen"; pos: number }
  | { kind: "eof"; pos: number };

function isWs(ch: string) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isIdentStart(ch: string) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentPart(ch: string) {
  return /[A-Za-z0-9_$.]/.test(ch);
}

export function tokenizeKql(input: string): Token[] {
  const s = String(input ?? "");
  const out: Token[] = [];
  let i = 0;

  const peek = () => s[i] ?? "";
  const next = () => s[i + 1] ?? "";

  const skipWsAndComments = () => {
    while (i < s.length) {
      if (isWs(peek())) {
        i++;
        continue;
      }
      // line comment
      if (peek() === "/" && next() === "/") {
        i += 2;
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      break;
    }
  };

  while (i < s.length) {
    skipWsAndComments();
    if (i >= s.length) break;

    const pos = i;
    const ch = peek();

    if (ch === "|") {
      out.push({ kind: "pipe", pos });
      i++;
      continue;
    }
    if (ch === ",") {
      out.push({ kind: "comma", pos });
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ kind: "lparen", pos });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ kind: "rparen", pos });
      i++;
      continue;
    }

    // ops
    const two = ch + next();
    if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
      out.push({ kind: "op", value: two as any, pos });
      i += 2;
      continue;
    }
    if (ch === ">" || ch === "<" || ch === "=") {
      out.push({ kind: "op", value: ch as any, pos });
      i++;
      continue;
    }

    // strings
    if (ch === "\"" || ch === "'") {
      const quote = ch;
      i++;
      let value = "";
      let escaped = false;
      while (i < s.length) {
        const c = s[i]!;
        i++;
        if (escaped) {
          if (c === "n") value += "\n";
          else if (c === "r") value += "\r";
          else if (c === "t") value += "\t";
          else value += c;
          escaped = false;
          continue;
        }
        if (c === "\\") {
          escaped = true;
          continue;
        }
        if (c === quote) break;
        value += c;
      }
      if (escaped) throw new KqlError("Unterminated escape sequence in string", pos);
      if (s[i - 1] !== quote) throw new KqlError("Unterminated string literal", pos);
      out.push({ kind: "string", value, pos });
      continue;
    }

    // numbers
    if (/[0-9]/.test(ch)) {
      let raw = ch;
      i++;
      while (i < s.length && /[0-9.]/.test(s[i]!)) {
        raw += s[i]!;
        i++;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new KqlError(`Invalid number: ${raw}`, pos);
      out.push({ kind: "number", value, raw, pos });
      continue;
    }

    // identifiers/keywords
    if (isIdentStart(ch)) {
      let value = ch;
      i++;
      while (i < s.length && isIdentPart(s[i]!)) {
        value += s[i]!;
        i++;
      }
      out.push({ kind: "identifier", value, pos });
      continue;
    }

    throw new KqlError(`Unexpected character: ${JSON.stringify(ch)}`, pos);
  }

  out.push({ kind: "eof", pos: s.length });
  return out;
}

