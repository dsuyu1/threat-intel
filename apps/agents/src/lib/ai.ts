/**
 * AI summarization helpers.
 *
 * Supports Gemini (via OpenAI-compatible endpoint) or OpenAI.
 * Priority: GEMINI_API_KEY → OPENAI_API_KEY
 *
 * Set in .env.local:
 *   GEMINI_API_KEY=your-key   ← recommended (free tier available)
 *   AI_MODEL=gemini-2.0-flash ← optional override
 */

import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;

  const geminiKey = process.env["GEMINI_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (geminiKey) {
    _client = new OpenAI({
      apiKey: geminiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  } else if (openaiKey) {
    _client = new OpenAI({ apiKey: openaiKey });
  } else {
    throw new Error("Set GEMINI_API_KEY or OPENAI_API_KEY in .env.local");
  }

  return _client;
}

function getModel(): string {
  if (process.env["AI_MODEL"]) return process.env["AI_MODEL"];
  return process.env["GEMINI_API_KEY"] ? "gemini-2.0-flash" : "gpt-4o-mini";
}

// ─── VulnAgent summarizer ─────────────────────────────────────────────────────

interface VulnSummaryInput {
  cveId: string;
  description: string;
  cvssScore: number | null;
  severity: string | null;
  isKev: boolean;
  kevAction?: string;
}

export async function summarizeVuln(input: VulnSummaryInput): Promise<string> {
  const { cveId, description, cvssScore, severity, isKev, kevAction } = input;

  const urgencyNote = isKev
    ? `CISA has added this to the Known Exploited Vulnerabilities catalog. Required action: ${kevAction ?? "patch immediately"}.`
    : "";

  const prompt = `You are a concise cybersecurity analyst writing for security professionals and developers.

Summarize this vulnerability in 2-3 sentences. Be specific: name the affected component, the attack type (RCE, XSS, privilege escalation, etc.), and the impact. Do not say "this vulnerability" — name the component directly.

CVE: ${cveId}
CVSS: ${cvssScore ?? "N/A"} (${severity ?? "unknown"})
${urgencyNote}
Description: ${description}

Write only the summary. No bullet points. No headers.`;

  const res = await getClient().chat.completions.create({
    model: getModel(),
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    temperature: 0.2,
  });

  return res.choices[0]?.message.content?.trim() ?? description.slice(0, 300);
}

// ─── AttackAgent summarizer ───────────────────────────────────────────────────

interface AttackSummaryInput {
  title: string;
  content: string;
  sourceUrl: string;
}

export async function summarizeAttack(input: AttackSummaryInput): Promise<string> {
  const prompt = `You are a threat intelligence analyst. Summarize this threat report in 3 sentences.
Cover: (1) who is attacking or what campaign this is, (2) targeted sector/geography, (3) the key technique or impact.

Title: ${input.title}
Source: ${input.sourceUrl}
Content: ${input.content.slice(0, 1500)}

Write only the summary. No bullet points.`;

  const res = await getClient().chat.completions.create({
    model: getModel(),
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    temperature: 0.2,
  });

  return res.choices[0]?.message.content?.trim() ?? input.title;
}

// ─── ExploitAgent summarizer ──────────────────────────────────────────────────

interface ExploitSummaryInput {
  cveId: string;
  repoUrl: string;
  repoDescription: string;
  stars: number;
  hoursToPoC: number | null;
}

export async function summarizeExploit(input: ExploitSummaryInput): Promise<string> {
  const prompt = `A public proof-of-concept exploit was published on GitHub for ${input.cveId}.
Repository: ${input.repoUrl}
Stars: ${input.stars}
Description: ${input.repoDescription}
Time from CVE disclosure to PoC: ${input.hoursToPoC != null ? `${input.hoursToPoC} hours` : "unknown"}

Write 2 sentences for a security team: what this PoC demonstrates and why the timing and star count matter for patch urgency.`;

  const res = await getClient().chat.completions.create({
    model: getModel(),
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
    temperature: 0.2,
  });

  return res.choices[0]?.message.content?.trim() ?? `PoC published for ${input.cveId}`;
}
