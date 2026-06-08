import { normalizeIoc, type IocKind, type NormalizedIoc } from "./normalize";

type Rule = {
  kind: IocKind;
  regex: RegExp;
  pick: (m: RegExpExecArray) => string;
};

const RULES: Rule[] = [
  {
    kind: "ipv4",
    regex: /ipv4-addr:value\s*=\s*(["'])([^"']+)\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "ipv6",
    regex: /ipv6-addr:value\s*=\s*(["'])([^"']+)\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "domain",
    regex: /domain-name:value\s*=\s*(["'])([^"']+)\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "url",
    regex: /url:value\s*=\s*(["'])([^"']+)\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "md5",
    regex: /file:hashes\.(?:["']?)MD5(?:["']?)\s*=\s*(["'])([0-9a-f]{32})\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "sha1",
    regex: /file:hashes\.(?:["']?)SHA-1(?:["']?)\s*=\s*(["'])([0-9a-f]{40})\1/gi,
    pick: (m) => m[2] ?? "",
  },
  {
    kind: "sha256",
    regex: /file:hashes\.(?:["']?)SHA-256(?:["']?)\s*=\s*(["'])([0-9a-f]{64})\1/gi,
    pick: (m) => m[2] ?? "",
  },
];

export function extractIocsFromStixPattern(pattern: string): NormalizedIoc[] {
  const p = String(pattern ?? "").trim();
  if (!p) return [];

  const out: NormalizedIoc[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = rule.regex.exec(p))) {
      const raw = rule.pick(m).trim();
      if (!raw) continue;
      const res = normalizeIoc(raw, rule.kind);
      if (!res.ok) continue;
      const key = `${res.ioc.kind}:${res.ioc.normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(res.ioc);
    }
  }

  return out;
}

