import { createHash } from "node:crypto";
import { normalizeIoc } from "@ti/db";
import { date, object, webUrl, type Audience } from "./education-brief.js";

const education = /\b(education|schools?|academia|academic institutions?)\b/i;
const higherEd = /\b(higher[- ]ed(?:ucation)?|universit(?:y|ies)|colleges?|campus|research institutions?)\b/i;
const k12 = /\b(k[\s–-]?12|school districts?|public schools?|elementary schools?|high schools?|school boards?)\b/i;
const topicRules = [
  ["ransomware", /\bransomware\b/i],
  ["exploited-vulnerability", /\b(?:CVE-\d{4}-\d{4,}|zero[- ]day|exploit(?:ed|ation)|vulnerabilit(?:y|ies))\b/i],
  ["identity", /\b(?:phishing|account takeover|credential(?:s| theft)?|password spray(?:ing)?|token theft|MFA bypass)\b/i],
  ["third-party", /\b(?:supply chain|data breach|third[- ]party|vendor advisory|data leak)\b/i],
  ["disruption", /\b(?:outage|DDoS|disruption)\b/i],
] as const;
const followUp = {
  "ransomware": { owner: "Incident response", action: "review relevant detections and recovery readiness" },
  "exploited-vulnerability": { owner: "Vulnerability management", action: "verify affected product versions and vendor mitigations" },
  "identity": { owner: "Identity team", action: "review relevant sign-in and email telemetry" },
  "third-party": { owner: "Application owner", action: "verify whether the relevant vendor or integration is in use" },
  "disruption": { owner: "IT operations", action: "review monitoring and continuity procedures for affected services" },
  "other": { owner: "IT security", action: "review the source and identify any applicable defensive actions" },
};
const security = /\b(?:cybersecurity|cyber[- ]?attack|cyber incident|infosec|security advisory|malware)\b/i;
const trackingKey = /^(?:utm_.+|fbclid|gclid|msclkid)$/i;

type Watch = { product: string; audiences: Audience[]; pattern: RegExp };

export function parseEducationWatchlist(input: string): Watch[] {
  const rows: unknown = JSON.parse(input);
  if (!Array.isArray(rows)) throw new Error("Watchlist must be an array");
  return rows.map((row, index) => {
    const { product, audiences } = object(row);
    if (typeof product !== "string" || !product.trim() || product.length > 120 || !Array.isArray(audiences) || !audiences.length ||
        !audiences.every((value) => value === "higher-ed" || value === "k-12")) {
      throw new Error(`Invalid watchlist entry ${index + 1}`);
    }
    const name = product.trim();
    const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      product: name,
      audiences: [...new Set<Audience>(audiences)],
      pattern: new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, "iu"),
    };
  });
}

export function canonicalNewsUrl(value: unknown) {
  const url = new URL(webUrl(value, "url"));
  url.hash = "";
  for (const key of [...new Set(url.searchParams.keys())]) {
    if (trackingKey.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function oneLine(value: string, limit: number) {
  return value.replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, limit);
}

function candidateFromLine(line: string, watchlist: Watch[]) {
  const row = object(JSON.parse(line));
  const url = canonicalNewsUrl(row.url);
  const published = date(row.date, "date");
  const title = typeof row.title === "string" ? oneLine(row.title, 400) : "";
  if (!title) throw new Error("title is required");
  const excerpt = typeof row.excerpt === "string" ? oneLine(row.excerpt, 3000) : "";
  const text = `${title} ${excerpt}`;
  const topic = topicRules.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
  const products = watchlist.filter(({ pattern }) => pattern.test(text));
  const audiences = new Set<Audience>();
  if (higherEd.test(text)) audiences.add("higher-ed");
  if (k12.test(text)) audiences.add("k-12");
  for (const product of products) for (const audience of product.audiences) audiences.add(audience);

  if (!audiences.size && !education.test(text)) return null;
  if (topic === "other" && !security.test(text)) return null;

  const cves = [...new Set(text.toUpperCase().match(/\bCVE-\d{4}-\d{4,}\b/g) ?? [])];
  const candidates: unknown[] = Array.isArray(row.iocCandidates) ? row.iocCandidates.slice(0, 100) : [];
  const normalizedIocs = new Map<string, { kind: string; value: string }>();
  for (const value of candidates) {
    if (typeof value !== "string" || value.length > 2048) continue;
    const result = normalizeIoc(value);
    if (!result.ok) continue;
    const { kind, normalized } = result.ioc;
    if (kind === "url" && !/^https?:\/\//.test(normalized)) continue;
    normalizedIocs.set(`${kind}:${normalized}`, { kind, value: normalized });
  }

  const actorCandidates = Array.isArray(row.actorCandidates)
    ? [...new Set(row.actorCandidates.slice(0, 30).flatMap((name: unknown) =>
      typeof name === "string" ? [oneLine(name, 120)].filter(Boolean) : [],
    ))]
    : [];

  return {
    id: `news-${createHash("sha256").update(url).digest("hex")}`,
    date: published,
    title,
    status: "draft" as const,
    sharing: "restricted" as const,
    sources: [url],
    audiences: [...audiences].sort(),
    topic,
    priority: "monitor" as const,
    ...followUp[topic],
    intake: {
      excerpt,
      products: products.map(({ product }) => product),
      cves,
      actorCandidates,
      iocCandidates: [...normalizedIocs.values()],
    },
  };
}

export function prepareEducationQueue(
  feed: string,
  watchlist: Watch[],
  handledIds: ReadonlySet<string>,
  reviewedUrls: string[],
) {
  const pending = new Map<string, NonNullable<ReturnType<typeof candidateFromLine>>>();
  const reviewed = new Set(reviewedUrls.map(canonicalNewsUrl));
  const invalidLines: number[] = [];
  const counts = { read: 0, unmatched: 0, duplicates: 0, alreadyHandled: 0 };
  for (const [index, line] of feed.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    counts.read++;
    let item: ReturnType<typeof candidateFromLine>;
    try {
      item = candidateFromLine(line, watchlist);
    } catch {
      invalidLines.push(index + 1);
      continue;
    }
    if (!item) {
      counts.unmatched++;
    } else if (handledIds.has(item.id) || reviewed.has(item.sources[0]!)) {
      counts.alreadyHandled++;
    } else if (pending.has(item.id)) {
      counts.duplicates++;
    } else {
      pending.set(item.id, item);
    }
  }
  const rows = [...pending.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    jsonl: rows.map((row) => JSON.stringify(row) + "\n").join(""),
    counts: { ...counts, queued: rows.length, invalidLines },
  };
}

export function lastCompletedSunday(now = new Date()) {
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() || 7));
  return day.toISOString().slice(0, 10);
}
