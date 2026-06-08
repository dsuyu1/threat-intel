export type KqlTableSchema = { name: string; columns: string[] };

export type DetectedTimeWindow = {
  sinceIso: string;
  untilIso: string;
  amount: number;
  unit: "day" | "week" | "month" | "year";
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseAmount(raw: string | null | undefined) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return 1;
  if (WORD_NUMBERS[s] != null) return WORD_NUMBERS[s]!;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

function daysInMonthUTC(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function subtractMonthsUTC(date: Date, months: number) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const ss = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  const total = y * 12 + m - months;
  let ty = Math.floor(total / 12);
  let tm = total % 12;
  if (tm < 0) {
    ty -= 1;
    tm += 12;
  }

  const maxDay = daysInMonthUTC(ty, tm);
  const td = Math.min(d, maxDay);
  return new Date(Date.UTC(ty, tm, td, hh, mm, ss, ms));
}

export function detectRelativeTimeWindow(question: string, now: Date = new Date()): DetectedTimeWindow | null {
  const q = String(question ?? "").toLowerCase();
  const m = q.match(
    /\b(?:in\s+the\s+)?(?:last|past)\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(day|days|week|weeks|month|months|year|years)\b/i
  );
  if (!m) return null;

  const amount = clamp(parseAmount(m[1]), 1, 120);
  const unitRaw = String(m[2] ?? "").toLowerCase();
  const unit =
    unitRaw.startsWith("day")
      ? ("day" as const)
      : unitRaw.startsWith("week")
        ? ("week" as const)
        : unitRaw.startsWith("month")
          ? ("month" as const)
          : ("year" as const);

  const until = now;
  const since =
    unit === "day"
      ? new Date(until.getTime() - amount * 24 * 60 * 60 * 1000)
      : unit === "week"
        ? new Date(until.getTime() - amount * 7 * 24 * 60 * 60 * 1000)
        : unit === "month"
          ? subtractMonthsUTC(until, amount)
          : subtractMonthsUTC(until, amount * 12);

  return {
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    amount,
    unit,
  };
}

function stripCodeFences(input: string) {
  const s = String(input ?? "").trim();
  const m = s.match(/^```[a-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? s).trim();
}

export function ensureTakeStage(kql: string, take: number = 50) {
  const s = String(kql ?? "").trim();
  if (!s) return s;
  if (/\|\s*(take|limit)\s+\d+\b/i.test(s)) return s;
  return `${s} | take ${Math.max(1, Math.floor(take))}`;
}

export function parseNlqModelResponse(text: string): { kql: string; explanation: string } {
  const raw = String(text ?? "").trim();
  const candidate = stripCodeFences(raw);

  for (const attempt of [raw, candidate]) {
    try {
      const obj = JSON.parse(attempt) as any;
      const kql = String(obj?.kql ?? "").trim();
      const explanation = String(obj?.explanation ?? "").trim();
      if (kql) return { kql, explanation };
    } catch {
      // continue
    }
  }

  return { kql: candidate, explanation: "" };
}

export function buildNlqPrompt(params: {
  question: string;
  nowIso: string;
  allowedTables: string[];
  schemas: KqlTableSchema[];
  timeWindow: DetectedTimeWindow | null;
}) {
  const tablesBlock = params.schemas
    .map((t) => `- ${t.name}: ${t.columns.join(", ")}`)
    .join("\n");

  const timeBlock = params.timeWindow
    ? [
        "Detected time window (use these ISO timestamps verbatim; do not use ago()/now()):",
        `- sinceIso: ${params.timeWindow.sinceIso}`,
        `- untilIso: ${params.timeWindow.untilIso}`,
        "",
      ].join("\n")
    : "";

  return [
    "You translate threat-intel analyst questions into a SINGLE query in our KQL dialect.",
    "Return JSON only (no markdown, no fences) in this shape:",
    '{"kql":"...","explanation":"..."}',
    "",
    "Constraints:",
    `- Use ONLY these tables: ${params.allowedTables.join(", ")}.`,
    "- Use ONLY the listed columns for those tables (do not invent columns).",
    "- Supported stages: where, project, sort by, take/limit, join (kind=inner|left|right|full), summarize (count,dcount,sum,avg,min,max).",
    "- Supported where operators: == != >= <= > <, in(...), and/or/not, contains(), startswith(), endswith(), isnull(), isnotnull().",
    "- Always include a take N stage (default 50) unless the user explicitly asks for a different size.",
    "- Prefer readable output: use project to return relevant columns.",
    "",
    `Current time (UTC): ${params.nowIso}`,
    timeBlock,
    "Table schemas:",
    tablesBlock,
    "",
    "Helpful semantics:",
    "- Actors.originIso2 is the actor origin country ISO2 code (e.g. RU).",
    "- Relations.lastSeen and Evidence.publishedAt are timestamps that can be filtered with ISO strings.",
    "- Common Relations.type values: actor_targets_sector, actor_origin_country, actor_uses_technique, actor_exploits_cve, technique_mitigated_by, technique_references_cve.",
    "",
    "Question:",
    params.question.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
