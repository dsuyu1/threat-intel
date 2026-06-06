export const runtime = "edge";

import { getDb, findings, soarWebhookConnections, type WebhookDeliveryCriteria, type SoarWebhookHeaders } from "@ti/db";
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

export async function POST(req: Request) {
  const db = getDb();
  const user = await getLocalUser();
  const body = (await req.json().catch(() => null)) as any;

  const ids = Array.isArray(body?.findingIds) ? body.findingIds.map(String).filter(Boolean) : [];
  if (!ids.length) return json({ error: "findingIds is required" }, { status: 400 });

  let connections: Array<{
    id: string;
    enabled: boolean;
    webhookUrl: string;
    headers: SoarWebhookHeaders | null;
    criteria: WebhookDeliveryCriteria | null;
  }> = [];

  try {
    connections = await db
      .select({
        id: soarWebhookConnections.id,
        enabled: soarWebhookConnections.enabled,
        webhookUrl: soarWebhookConnections.webhookUrl,
        headers: soarWebhookConnections.headers,
        criteria: soarWebhookConnections.criteria,
      })
      .from(soarWebhookConnections)
      .where(and(eq(soarWebhookConnections.userId, user.id), eq(soarWebhookConnections.enabled, true)))
      .limit(25);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "SOAR tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!connections.length) {
    return json({ error: "No enabled SOAR webhook connections found." }, { status: 409 });
  }

  const selected = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      cveId: findings.cveId,
      tags: findings.tags,
      sourceUrl: findings.sourceUrl,
      sourceTitle: findings.sourceTitle,
      pocUrl: findings.pocUrl,
      pocLevel: findings.pocLevel,
      publishedAt: findings.publishedAt,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .where(inArray(findings.id, ids))
    .limit(500);

  const origin = new URL(req.url).origin;
  const nowIso = new Date().toISOString();

  let sent = 0;
  let failed = 0;

  for (const f of selected) {
    const tags = parseTags(f.tags ?? null);
    const findingPayload = {
      id: f.id,
      agent: String(f.agent),
      title: f.title,
      summary: f.summary ?? null,
      severity: f.severity ? String(f.severity) : null,
      cveId: f.cveId ?? null,
      cvss: {
        score: f.cvssScore ? Number(f.cvssScore) : null,
        vector: f.cvssVector ?? null,
      },
      tags,
      source: { url: f.sourceUrl ?? null, title: f.sourceTitle ?? null },
      poc: { url: f.pocUrl ?? null, level: f.pocLevel ? String(f.pocLevel) : null },
      publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : null,
      createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : null,
      url: `${origin}/findings/${f.id}`,
    };

    for (const c of connections) {
      if (!matchesCriteria(c.criteria ?? null, f)) continue;
      try {
        const res = await fetch(c.webhookUrl, {
          method: "POST",
          headers: { ...(c.headers ?? {}), "content-type": "application/json" },
          body: JSON.stringify({ finding: findingPayload, actionItems: [], sentAt: nowIso }),
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

