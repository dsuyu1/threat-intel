import {
  findings,
  jiraAutomationConnections,
  jiraAutomationDeliveries,
  type JiraAutomationCriteria,
} from "@ti/db";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<any>;

function safeParseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function splitMitreIds(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isKev(tags: string[]) {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  return t.has("kev") || t.has("actively-exploited");
}

function safeExternalHref(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function matchesCriteria(
  finding: {
    agent: string;
    severity: string | null;
    cvssScore: any;
    cveId: string | null;
    tags: string | null;
  },
  criteria: JiraAutomationCriteria
) {
  if (criteria.agents?.length && !criteria.agents.includes(String(finding.agent))) return false;
  if (criteria.severities?.length) {
    const sev = finding.severity ? String(finding.severity) : "";
    if (!criteria.severities.includes(sev)) return false;
  }
  if (criteria.requireCve && !finding.cveId) return false;

  const tags = safeParseJsonArray(finding.tags);
  if (criteria.requireKev && !isKev(tags)) return false;

  if (criteria.tagsAny?.length) {
    const set = new Set(tags.map((t) => t.toLowerCase()));
    const ok = criteria.tagsAny.some((t) => set.has(String(t).toLowerCase()));
    if (!ok) return false;
  }

  if (criteria.tagsAll?.length) {
    const set = new Set(tags.map((t) => t.toLowerCase()));
    const ok = criteria.tagsAll.every((t) => set.has(String(t).toLowerCase()));
    if (!ok) return false;
  }

  if (typeof criteria.minCvss === "number") {
    const score = finding.cvssScore == null ? null : Number(finding.cvssScore);
    if (score == null || !Number.isFinite(score) || score < criteria.minCvss) return false;
  }

  return true;
}

function buildPayload(params: {
  finding: {
    id: string;
    agent: string;
    title: string;
    summary: string | null;
    severity: string | null;
    cvssScore: any;
    cvssVector: string | null;
    cveId: string | null;
    mitreIds: string | null;
    tags: string | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    pocUrl: string | null;
    pocLevel: string | null;
    publishedAt: Date | null;
    createdAt: Date;
  };
}) {
  const appUrl = String(process.env["NEXT_PUBLIC_APP_URL"] ?? "").trim().replace(/\/$/, "");
  const findingUrl = appUrl ? `${appUrl}/findings/${params.finding.id}` : null;

  const tags = safeParseJsonArray(params.finding.tags);
  const mitreIds = splitMitreIds(params.finding.mitreIds);

  const actionItems: Array<{ type: string; label: string; value?: string; url?: string }> = [];
  if (params.finding.cveId) {
    actionItems.push({
      type: "patch",
      label: `Prioritize patching ${params.finding.cveId}`,
      value: params.finding.cveId,
    });
  }
  for (const id of mitreIds) {
    actionItems.push({
      type: "ttp",
      label: `Hunt/block for ${id}`,
      value: id,
      url: `https://attack.mitre.org/techniques/${encodeURIComponent(id)}/`,
    });
  }
  if (isKev(tags)) {
    actionItems.push({
      type: "kev",
      label: "Treat as actively exploited (CISA KEV / AE tag)",
    });
  }

  const cvssScore =
    params.finding.cvssScore == null ? null : Number(params.finding.cvssScore);

  return {
    event: "finding.created",
    finding: {
      id: params.finding.id,
      url: findingUrl,
      agent: params.finding.agent,
      title: params.finding.title,
      summary: params.finding.summary,
      severity: params.finding.severity,
      cveId: params.finding.cveId,
      tags,
      mitre: { ids: mitreIds },
      cvss: {
        score: Number.isFinite(cvssScore) ? cvssScore : null,
        vector: params.finding.cvssVector,
      },
      source: {
        title: params.finding.sourceTitle,
        url: params.finding.sourceUrl,
      },
      poc: {
        url: params.finding.pocUrl,
        level: params.finding.pocLevel,
      },
      publishedAt: params.finding.publishedAt?.toISOString?.() ?? null,
      createdAt: params.finding.createdAt.toISOString(),
    },
    actionItems,
  };
}

export async function dispatchJiraAutomationForFindingId(db: Db, findingId: string) {
  try {
  const [finding] = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      cveId: findings.cveId,
      mitreIds: findings.mitreIds,
      tags: findings.tags,
      sourceUrl: findings.sourceUrl,
      sourceTitle: findings.sourceTitle,
      pocUrl: findings.pocUrl,
      pocLevel: findings.pocLevel,
      publishedAt: findings.publishedAt,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .where(eq(findings.id, findingId))
    .limit(1);

  if (!finding) return;

  const conns = await db
    .select({
      id: jiraAutomationConnections.id,
      enabled: jiraAutomationConnections.enabled,
      webhookUrl: jiraAutomationConnections.webhookUrl,
      criteria: jiraAutomationConnections.criteria,
    })
    .from(jiraAutomationConnections)
    .where(eq(jiraAutomationConnections.enabled, true));

  if (!conns.length) return;

  const delivered = await db
    .select({ connectionId: jiraAutomationDeliveries.connectionId })
    .from(jiraAutomationDeliveries)
    .where(
      and(
        eq(jiraAutomationDeliveries.findingId, findingId),
        inArray(
          jiraAutomationDeliveries.connectionId,
          conns.map((c) => c.id)
        )
      )
    );

  const deliveredSet = new Set(delivered.map((d) => d.connectionId));
  const payload = buildPayload({ finding: finding as any });

  for (const c of conns) {
    if (deliveredSet.has(c.id)) continue;
    const href = safeExternalHref(String(c.webhookUrl ?? ""));
    if (!href) continue;
    const criteria = (c.criteria ?? {}) as JiraAutomationCriteria;
    if (!matchesCriteria(finding as any, criteria)) continue;

    try {
      const res = await fetch(href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text().catch(() => "");
      await db
        .insert(jiraAutomationDeliveries)
        .values({
          connectionId: c.id,
          findingId,
          status: res.ok ? "sent" : "failed",
          httpStatus: res.status,
          responseBody: body ? body.slice(0, 4000) : null,
          sentAt: new Date(),
        })
        .onConflictDoNothing();
    } catch (err) {
      await db
        .insert(jiraAutomationDeliveries)
        .values({
          connectionId: c.id,
          findingId,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          sentAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }
  } catch (err) {
    // Avoid failing ingestion if migrations haven't been applied yet.
    console.warn("[JiraAutomation] Dispatch skipped:", err instanceof Error ? err.message : err);
  }
}
