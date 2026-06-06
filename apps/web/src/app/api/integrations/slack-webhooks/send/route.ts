export const runtime = "edge";

import { getDb, findings, slackWebhookConnections, type WebhookDeliveryCriteria } from "@ti/db";
import { and, eq, inArray } from "drizzle-orm";
import { getLocalUser } from "../../../../../lib/local-user";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
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

function matchesCriteria(c: WebhookDeliveryCriteria | null, finding: any) {
  if (!c) return true;

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

function slackPayload(params: {
  origin: string;
  finding: {
    id: string;
    agent: string;
    title: string;
    severity: string | null;
    cveId: string | null;
    cvssScore: number | null;
    sourceUrl: string | null;
    tags: string[];
  };
}) {
  const url = `${params.origin}/findings/${params.finding.id}`;
  const title = params.finding.cveId ? `${params.finding.cveId} — ${params.finding.title}` : params.finding.title;
  const sev = params.finding.severity ?? "unknown";
  const cvss = typeof params.finding.cvssScore === "number" ? params.finding.cvssScore.toFixed(1) : "n/a";
  const parts = [
    `*${title}*`,
    `Severity: ${sev} | Agent: ${params.finding.agent} | CVSS: ${cvss}`,
    params.finding.sourceUrl ? `<${params.finding.sourceUrl}|Source>` : null,
    params.finding.tags?.length ? `Tags: ${params.finding.tags.slice(0, 8).join(", ")}` : null,
    `<${url}|Open in Threat Intel>`,
  ].filter(Boolean);
  return { text: parts.join("\n") };
}

export async function POST(req: Request) {
  const db = getDb();
  const user = await getLocalUser();
  const body = (await req.json().catch(() => null)) as any;

  const ids = Array.isArray(body?.findingIds) ? body.findingIds.map(String).filter(Boolean) : [];
  if (!ids.length) return json({ error: "findingIds is required" }, { status: 400 });

  let connections: Array<{ id: string; enabled: boolean; webhookUrl: string; criteria: WebhookDeliveryCriteria | null }> =
    [];
  try {
    connections = await db
      .select({
        id: slackWebhookConnections.id,
        enabled: slackWebhookConnections.enabled,
        webhookUrl: slackWebhookConnections.webhookUrl,
        criteria: slackWebhookConnections.criteria,
      })
      .from(slackWebhookConnections)
      .where(and(eq(slackWebhookConnections.userId, user.id), eq(slackWebhookConnections.enabled, true)))
      .limit(25);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Slack tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!connections.length) {
    return json({ error: "No enabled Slack webhook connections found." }, { status: 409 });
  }

  const selected = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cveId: findings.cveId,
      tags: findings.tags,
      sourceUrl: findings.sourceUrl,
    })
    .from(findings)
    .where(inArray(findings.id, ids))
    .limit(500);

  const origin = new URL(req.url).origin;

  let sent = 0;
  let failed = 0;

  for (const f of selected) {
    const tags = parseTags(f.tags ?? null);
    const findingPayload = {
      id: f.id,
      agent: String(f.agent),
      title: f.title,
      severity: f.severity ? String(f.severity) : null,
      cveId: f.cveId ?? null,
      cvssScore: f.cvssScore ? Number(f.cvssScore) : null,
      sourceUrl: f.sourceUrl ?? null,
      tags,
    };

    for (const c of connections) {
      if (!matchesCriteria(c.criteria ?? null, f)) continue;
      try {
        const res = await fetch(c.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(slackPayload({ origin, finding: findingPayload })),
        });
        if (!res.ok) failed += 1;
        else sent += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return json({ ok: true, sent, failed, connections: connections.length, findings: selected.length });
}

