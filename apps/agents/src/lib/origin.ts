const ORIGIN_KEYWORDS =
  "(?:attribut(?:ed|ion)|linked|associated|believ(?:ed)?|suspect(?:ed)?|likely|assess(?:ed|ment)|state-sponsored|sponsored|government|intelligence|military|based\\s+(?:in|out\\s+of)|operat(?:es|ed|ing)\\s+(?:in|out\\s+of)|originat(?:ed|ing)\\s+from)";

type OriginRule = {
  iso2: string;
  terms: string[];
};

const RULES: OriginRule[] = [
  { iso2: "RU", terms: ["russia", "russian", "svr", "gru", "fsb"] },
  { iso2: "CN", terms: ["china", "chinese", "pla", "mss"] },
  { iso2: "IR", terms: ["iran", "iranian", "irgc"] },
  { iso2: "KP", terms: ["north korea", "north korean", "dprk"] },
  { iso2: "KR", terms: ["south korea", "south korean"] },
  { iso2: "US", terms: ["united states", "u.s.", "u.s", "american"] },
  { iso2: "IL", terms: ["israel", "israeli"] },
  { iso2: "VN", terms: ["vietnam", "vietnamese"] },
];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTermGroup(terms: string[]) {
  // Terms can include spaces or periods.
  return `(?:${terms.map((t) => escapeRegex(t)).join("|")})`;
}

function findFirst(text: string, re: RegExp) {
  const m = re.exec(text);
  if (!m || typeof m.index !== "number") return null;
  return { index: m.index, match: m[0] };
}

function excerptAround(text: string, index: number) {
  const start = Math.max(0, index - 100);
  const end = Math.min(text.length, index + 180);
  return text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

export function inferOriginFromText(
  text: string
): { iso2: string; confidence: number; excerpt: string } | null {
  const t = text.trim();
  if (!t) return null;

  let best:
    | { iso2: string; confidence: number; excerpt: string; score: number }
    | null = null;

  for (const rule of RULES) {
    const termGroup = makeTermGroup(rule.terms);

    // "attributed to Russia" OR "Russian ... attributed"
    const strongA = new RegExp(`${ORIGIN_KEYWORDS}[\\s\\S]{0,160}${termGroup}`, "i");
    const strongB = new RegExp(`${termGroup}[\\s\\S]{0,160}${ORIGIN_KEYWORDS}`, "i");
    const weak = new RegExp(`${termGroup}`, "i");

    const strongHit = findFirst(t, strongA) ?? findFirst(t, strongB);
    if (strongHit) {
      const candidate = {
        iso2: rule.iso2,
        confidence: 0.65,
        excerpt: excerptAround(t, strongHit.index),
        score: 3,
      };
      if (!best || candidate.score > best.score) best = candidate;
      continue;
    }

    const weakHit = findFirst(t, weak);
    if (weakHit) {
      const candidate = {
        iso2: rule.iso2,
        confidence: 0.35,
        excerpt: excerptAround(t, weakHit.index),
        score: 1,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  return best ? { iso2: best.iso2, confidence: best.confidence, excerpt: best.excerpt } : null;
}

