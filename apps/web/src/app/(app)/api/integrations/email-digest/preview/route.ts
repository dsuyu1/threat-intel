export const runtime = "edge";

import { getDb, findings, type WebhookDeliveryCriteria } from "@ti/db";
import { desc } from "drizzle-orm";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeRecipients(input: unknown, fallback: string | null): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((x) => String(x))
    : typeof input === "string"
      ? input
          .split(/[,\n]/g)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (!raw.length && fallback) raw.push(fallback);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const v = r.trim().toLowerCase();
    if (!v) continue;
    if (!isEmail(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.slice(0, 50);
}

function normalizeFrequency(input: unknown): "daily" | "weekly" {
  return String(input ?? "").trim() === "weekly" ? "weekly" : "daily";
}

function toStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeCriteria(input: unknown): WebhookDeliveryCriteria {
  const c = (input ?? {}) as any;
  const agents = toStringArray(c.agents);
  const severities = toStringArray(c.severities);
  const minCvss = toNumber(c.minCvss);
  const requireCve = toBool(c.requireCve);
  const requireKev = toBool(c.requireKev);
  const tagsAny = toStringArray(c.tagsAny);
  const tagsAll = toStringArray(c.tagsAll);

  const out: WebhookDeliveryCriteria = {};
  if (agents?.length) out.agents = agents;
  if (severities?.length) out.severities = severities;
  if (typeof minCvss === "number") out.minCvss = Math.max(0, Math.min(10, minCvss));
  if (typeof requireCve === "boolean") out.requireCve = requireCve;
  if (typeof requireKev === "boolean") out.requireKev = requireKev;
  if (tagsAny?.length) out.tagsAny = tagsAny;
  if (tagsAll?.length) out.tagsAll = tagsAll;
  return out;
}

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? (JSON.parse(tagsJson) as string[]) : [];
  } catch {
    return [];
  }
}

function hasTag(tags: string[], t: string) {
  const needle = t.toLowerCase();
  return tags.some((x) => x.toLowerCase() === needle);
}

function matchesCriteria(c: WebhookDeliveryCriteria, finding: any) {
  const tags = parseTags(finding.tags ?? null);

  if (c.agents?.length && !c.agents.includes(String(finding.agent))) return false;
  if (c.severities?.length && !c.severities.includes(String(finding.severity ?? ""))) return false;

  if (typeof c.minCvss === "number") {
    const n = Number(finding.cvssScore ?? NaN);
    if (!Number.isFinite(n) || n < c.minCvss) return false;
  }

  if (c.requireCve && !String(finding.cveId ?? "").trim()) return false;
  if (c.requireKev && !hasTag(tags, "kev")) return false;

  if (c.tagsAny?.length) {
    const ok = c.tagsAny.some((t) => hasTag(tags, t));
    if (!ok) return false;
  }
  if (c.tagsAll?.length) {
    const ok = c.tagsAll.every((t) => hasTag(tags, t));
    if (!ok) return false;
  }

  return true;
}

export async function POST(req: Request) {
  const db = getDb();
  const viewer = await getViewerContext();
  const body = (await req.json().catch(() => null)) as any;

  const frequency = normalizeFrequency(body?.frequency);
  const criteria = normalizeCriteria(body?.criteria);
  const recipients = normalizeRecipients(body?.recipients, viewer.user.email ?? null);

  if (!recipients.length) return json({ error: "recipients must be a non-empty list of emails" }, { status: 400 });

  const hours = frequency === "weekly" ? 24 * 7 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const windowLabel = frequency === "weekly" ? "Last 7 days" : "Last 24 hours";

  const recent = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cveId: findings.cveId,
      tags: findings.tags,
      sourceUrl: findings.sourceUrl,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .orderBy(desc(findings.createdAt))
    .limit(1000);

  const matching = recent.filter((f) => {
    const createdAt = f.createdAt ? new Date(f.createdAt) : null;
    if (!createdAt) return false;
    if (createdAt < since) return false;
    return matchesCriteria(criteria, f);
  });

  const origin = new URL(req.url).origin;
  const top = matching.slice(0, 50);

  const lines: string[] = [];
  if (!top.length) {
    lines.push(`Threat Intel digest`);
    lines.push(`Window: ${windowLabel}`);
    lines.push("");
    lines.push("No findings match your current criteria in this window.");
  } else {
    lines.push(`Threat Intel digest`);
    lines.push(`Window: ${windowLabel}`);
    lines.push(`Findings: ${matching.length}`);
    lines.push("");

    for (let i = 0; i < top.length; i += 1) {
      const f = top[i]!;
      const sev = f.severity ? String(f.severity) : "unknown";
      const cvssNum = f.cvssScore == null ? null : Number(f.cvssScore);
      const cvss = Number.isFinite(cvssNum ?? NaN) ? (cvssNum as number).toFixed(1) : "n/a";
      const title = f.cveId ? `${f.cveId} — ${f.title}` : f.title;
      const url = `${origin}/findings/${f.id}`;
      const tags = parseTags(f.tags ?? null);

      lines.push(`${i + 1}. [${sev}] ${title}`);
      lines.push(`   Agent: ${String(f.agent)} | CVSS: ${cvss}`);
      if (f.sourceUrl) lines.push(`   Source: ${f.sourceUrl}`);
      if (tags.length) lines.push(`   Tags: ${tags.slice(0, 8).join(", ")}`);
      lines.push(`   Open: ${url}`);
      lines.push("");
    }

    if (matching.length > top.length) {
      lines.push(`… and ${matching.length - top.length} more.`);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const subject = frequency === "weekly" ? `Threat Intel weekly digest (${date})` : `Threat Intel daily digest (${date})`;

  return json({
    subject,
    recipients,
    windowLabel,
    body: lines.join("\n").trimEnd(),
    count: matching.length,
  });
}

