/**
 * AI summarization helpers.
 *
 * Supports Gemini (direct API) or OpenAI/OpenAI-compatible APIs.
 *
 * Set in .env.local:
 *   OPENAI_API_KEY=...        ← or any OpenAI-compatible key
 *   OPENAI_BASE_URL=...       ← required for OpenAI-compatible providers (optional for OpenAI)
 *   AI_MODEL=...              ← optional override
 */

import { generateText } from "./openai.js";

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

  const content = await generateText({ prompt, maxTokens: 200, temperature: 0.2 });
  return content.trim() || description.slice(0, 300);
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

  const content = await generateText({ prompt, maxTokens: 200, temperature: 0.2 });
  return content.trim() || input.title;
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

  const content = await generateText({ prompt, maxTokens: 150, temperature: 0.2 });
  return content.trim() || `PoC published for ${input.cveId}`;
}
