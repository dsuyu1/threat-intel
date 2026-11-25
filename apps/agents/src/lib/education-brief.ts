import { isIP } from "node:net";
import { normalizeIoc, type IocKind } from "@ti/db";

const audiences = ["higher-ed", "k-12"] as const;
const topics = ["identity", "ransomware", "third-party", "exploited-vulnerability", "disruption", "other"] as const;
const priorities = ["act-now", "check-exposure", "monitor"] as const;
const confidenceLevels = ["low", "medium", "high"] as const;
const indicatorKinds = ["ipv4", "ipv6", "domain", "url", "md5", "sha1", "sha256"] as const;
const coverageLabels = {
  "reported-targeting": "Reported education targeting",
  "technology-exposure": "Education technology exposure",
  "education-advisory": "Education advisory",
} as const;

type Audience = (typeof audiences)[number];
type Coverage = keyof typeof coverageLabels;
type Indicator = {
  kind: IocKind;
  value: string;
  confidence: "medium" | "high";
  validThrough: string;
  sourceUrl: string;
};

type Entry = {
  id: string;
  date: string;
  title: string;
  summary: string;
  action: string;
  owner: string;
  audiences: Audience[];
  coverage: Coverage;
  topic: (typeof topics)[number];
  priority: (typeof priorities)[number];
  sources: string[];
  attribution?: { actor: string; confidence: (typeof confidenceLevels)[number]; sourceUrl: string };
  indicators: Indicator[];
};

const audienceLabels: Record<Audience, string> = { "higher-ed": "Higher ed", "k-12": "K–12" };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function field(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} must be a nonempty, single-line string`);
  }
  return value.trim();
}

function choice<T extends string>(value: unknown, options: readonly T[], name: string): T {
  const match = options.find((option) => option === value);
  if (!match) throw new Error(`${name} must be one of ${options.join(", ")}`);
  return match;
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function date(value: unknown, name: string): string {
  const input = field(value, name);
  const parsed = new Date(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== input) {
    throw new Error(`${name} must be a real UTC date (YYYY-MM-DD)`);
  }
  return input;
}

function webUrl(value: unknown, name: string): string {
  const input = field(value, name);
  const parsed = URL.canParse(input) ? new URL(input) : null;
  if (!parsed || !["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return parsed.href;
}

function parseEntry(record: Record<string, unknown>): Entry {
  const published = date(record.date, "date");
  const scope = [...new Set(list(record.audiences, "audiences").map((item) => choice(item, audiences, "audience")))];
  const sources = [...new Set(list(record.sources, "sources").map((item) => webUrl(item, "source URL")))];
  if (!scope.length || !sources.length) throw new Error("At least one audience and source URL are required");

  function citedSource(value: unknown, name: string) {
    const url = webUrl(value, name);
    if (!sources.includes(url)) throw new Error(`${name} must also appear in sources`);
    return url;
  }

  const indicators = list(record.indicators ?? [], "indicators").map((item): Indicator => {
    const input = object(item);
    const kind = choice(input.kind, indicatorKinds, "indicator.kind");
    const value = kind === "url" ? webUrl(input.value, "indicator.value") : field(input.value, "indicator.value");
    const normalized = normalizeIoc(value, kind);
    if (!normalized.ok) throw new Error(`Invalid ${kind} indicator`);
    if (kind === "ipv6" && isIP(normalized.ioc.normalized) !== 6) {
      throw new Error("Invalid ipv6 indicator");
    }
    if (kind === "domain" && (/[\s@:#?%\\]/u.test(value) || isIP(normalized.ioc.normalized))) {
      throw new Error("Invalid domain indicator");
    }
    const validThrough = date(input.validThrough, "indicator.validThrough");
    if (validThrough < published) throw new Error("indicator.validThrough cannot precede the entry date");
    return {
      kind,
      value: normalized.ioc.normalized,
      validThrough,
      confidence: choice(input.confidence, ["medium", "high"], "indicator.confidence"),
      sourceUrl: citedSource(input.sourceUrl, "indicator.sourceUrl"),
    };
  });

  const attribution = record.attribution === undefined ? undefined : object(record.attribution);
  return {
    id: field(record.id, "id"),
    date: published,
    title: field(record.title, "title"),
    summary: field(record.summary, "summary"),
    action: field(record.action, "action"),
    owner: field(record.owner, "owner"),
    audiences: scope,
    sources,
    coverage: choice(record.coverage, Object.keys(coverageLabels) as Coverage[], "coverage"),
    topic: choice(record.topic, topics, "topic"),
    priority: choice(record.priority, priorities, "priority"),
    attribution: attribution && {
      actor: field(attribution.actor, "attribution.actor"),
      confidence: choice(attribution.confidence, confidenceLevels, "attribution.confidence"),
      sourceUrl: citedSource(attribution.sourceUrl, "attribution.sourceUrl"),
    },
    indicators,
  };
}

export function parseEducationEntries(input: string): Entry[] {
  const entries = new Map<string, Entry>();
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = object(JSON.parse(line));
      const status = choice(record.status, ["draft", "approved"], "status");
      const sharing = choice(record.sharing, ["public", "restricted"], "sharing");
      if (status !== "approved" || sharing !== "public") continue;
      const entry = parseEntry(record);
      if (entries.has(entry.id)) throw new Error(`Duplicate approved entry ID ${entry.id}`);
      entries.set(entry.id, entry);
    } catch (error) {
      const reason = error instanceof SyntaxError ? "Invalid JSON" : (error as Error).message;
      throw new Error(`Input line ${index + 1}: ${reason}`);
    }
  }
  return [...entries.values()];
}

function offsetDate(day: string, offset: number) {
  const utc = new Date(`${day}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

function markdown(value: string) {
  return value.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]\\^`_{|}~]/g, "\\$&");
}

function reference(url: string, label = "Source") {
  return `[${label}](<${url.replace(/[<>\\]/g, encodeURIComponent)}>)`;
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createEducationBrief(entries: Entry[], endDate: string, newsletter = false) {
  const end = date(endDate, "week end");
  const start = offsetDate(end, -6);
  const previousStart = offsetDate(end, -13);
  const previousEnd = offsetDate(end, -7);
  const current = entries.filter((entry) => entry.date >= start && entry.date <= end)
    .sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
      b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const previous = entries.filter((entry) => entry.date >= previousStart && entry.date <= previousEnd);
  const period = `${start} to ${end} (UTC)`;

  const trends = [
    "| Audience | Topic | This week | Previous week |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const audience of audiences) {
    for (const topic of topics) {
      const matches = (entry: Entry) => entry.coverage === "reported-targeting" &&
        entry.audiences.includes(audience) && entry.topic === topic;
      const now = current.filter(matches).length;
      const before = previous.filter(matches).length;
      if (now || before) trends.push(`| ${audienceLabels[audience]} | ${topic} | ${now} | ${before} |`);
    }
  }

  const report = [
    "# Education threat intelligence brief",
    period,
    "## What to act on",
    ...current.map((entry) => [
      `### ${markdown(entry.title)}`,
      `**${entry.priority}** · ${entry.audiences.map((audience) => audienceLabels[audience]).join(", ")} · ${coverageLabels[entry.coverage]} · ${entry.date}`,
      markdown(entry.summary),
      `**${markdown(entry.owner)}** should ${markdown(entry.action)}`,
      entry.sources.map((source, index) => reference(source, `Source ${index + 1}`)).join(" · "),
    ].join("\n\n")),
    ...(current.length ? [] : ["No reviewed entries for this period."]),
    "## Reported targeting trends",
    `Previous period: ${previousStart} to ${previousEnd} (UTC). Counts reflect reviewed records and reporting coverage. Records tagged for both audiences appear on both rows for their topic.`,
    trends.length > 2 ? trends.join("\n") : "No reported education targeting in the reviewed records for either period.",
    "## Reported actor activity",
    ...current.flatMap(({ attribution, title, date: observed }) => attribution ? [
      `- **${markdown(attribution.actor)}** · ${attribution.confidence} confidence · ${observed} · ${markdown(title)} · ${reference(attribution.sourceUrl)}`,
    ] : []),
    ...(current.some((entry) => entry.attribution) ? [] : ["No reviewed actor attribution for this period."]),
    "## Indicators",
    "See the companion CSV for time-bounded indicators and their source evidence. Use the indicators as context for investigation.",
  ].join("\n\n") + "\n";

  const indicatorRows = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.date > end) continue;
    for (const ioc of entry.indicators) {
      if (ioc.validThrough < end) continue;
      const row = [
        ioc.kind, ioc.value, entry.date, ioc.validThrough, ioc.confidence,
        entry.audiences.join(";"), entry.id, ioc.sourceUrl,
      ];
      indicatorRows.set(JSON.stringify(row), row);
    }
  }

  const highlights = current.slice(0, 3);
  const blog = [
    "# This week in education cybersecurity",
    period,
    ...highlights.map((entry) => [
      `## ${markdown(entry.title)}`,
      markdown(entry.summary),
      `**Who should check:** ${entry.audiences.map((audience) => audienceLabels[audience]).join(", ")} · ${coverageLabels[entry.coverage]}`,
      `**${markdown(entry.owner)}** should ${markdown(entry.action)}`,
      entry.sources.map((source, index) => reference(source, `Source ${index + 1}`)).join(" · "),
    ].join("\n\n")),
    ...(highlights.length ? [] : ["No reviewed items for this period."]),
  ].join("\n\n") + "\n";

  const files: Record<string, string> = {
    "report.md": report,
    "iocs.csv": [
      "kind,value,entry_date,valid_through,confidence,audiences,entry_id,source_url",
      ...[...indicatorRows.values()].map((row) => row.map(csvCell).join(",")),
    ].join("\r\n") + "\r\n",
    "blog-draft.md": blog,
  };

  if (newsletter) {
    files["newsletter-draft.md"] = [
      "# Education cyber watch",
      period,
      ...highlights.map((entry) =>
        `- **${markdown(entry.title)}** · ${entry.audiences.map((audience) => audienceLabels[audience]).join(", ")} · ${coverageLabels[entry.coverage]} · ${markdown(entry.owner)} should ${markdown(entry.action)} · ${reference(entry.sources[0]!)}`),
      ...(highlights.length ? [] : ["No reviewed items for this period."]),
    ].join("\n\n") + "\n";
  }
  return files;
}
