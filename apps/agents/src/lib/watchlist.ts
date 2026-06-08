import {
  alerts,
  discordWebhookConnections,
  findings,
  kgRelations,
  slackWebhookConnections,
  soarWebhookConnections,
  watchlistDeliveries,
  watchlistItems,
} from "@ti/db";
import { and, eq, inArray, or } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

type Db = NeonHttpDatabase<any>;

function safeExternalHref(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

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

function buildAppFindingUrl(findingId: string) {
  const appUrl = String(process.env["NEXT_PUBLIC_APP_URL"] ?? "").trim().replace(/\/$/, "");
  return appUrl ? `${appUrl}/findings/${findingId}` : null;
}

function buildSoarPayload(params: {
  finding: any;
  matches: Array<{ kind: string; value: string }>;
}) {
  return {
    event: "watchlist.match",
    matches: params.matches,
    finding: {
      id: params.finding.id,
      url: buildAppFindingUrl(params.finding.id),
      agent: params.finding.agent,
      title: params.finding.title,
      summary: params.finding.summary,
      severity: params.finding.severity,
      cveId: params.finding.cveId,
      mitreIds: splitMitreIds(params.finding.mitreIds),
      tags: safeParseJsonArray(params.finding.tags),
      cvss: {
        score: params.finding.cvssScore == null ? null : Number(params.finding.cvssScore),
        vector: params.finding.cvssVector,
      },
      epss: {
        score: params.finding.epssScore == null ? null : Number(params.finding.epssScore),
        percentile: params.finding.epssPercentile == null ? null : Number(params.finding.epssPercentile),
        updatedAt: params.finding.epssUpdatedAt?.toISOString?.() ?? null,
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
  };
}

function fmtSlackText(params: { finding: any; matches: Array<{ kind: string; value: string }> }) {
  const cve = params.finding.cveId ? ` (${params.finding.cveId})` : "";
  const url = buildAppFindingUrl(params.finding.id);
  const lines: string[] = [];
  lines.push(`Watchlist match: ${params.finding.title}${cve}`);
  if (typeof params.finding.epssScore === "string" || typeof params.finding.epssScore === "number") {
    const n = Number(params.finding.epssScore);
    if (Number.isFinite(n)) lines.push(`EPSS: ${n.toFixed(3)}`);
  }
  lines.push(`Matched: ${params.matches.map((m) => `${m.kind}:${m.value}`).join(", ")}`);
  if (url) lines.push(url);
  return lines.join("\n");
}

async function resolveActorIdsForFinding(params: {
  db: Db;
  cveId: string | null;
  techniqueIds: string[];
}): Promise<string[]> {
  const actorIds = new Set<string>();

  if (params.cveId) {
    const rows = await params.db
      .select({ actorId: kgRelations.fromId })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "actor_exploits_cve"),
          eq(kgRelations.fromKind, "actor"),
          eq(kgRelations.toKind, "cve"),
          eq(kgRelations.toId, params.cveId)
        )
      )
      .limit(200);
    for (const r of rows) actorIds.add(r.actorId);
  }

  if (params.techniqueIds.length) {
    const rows = await params.db
      .select({ actorId: kgRelations.fromId })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.type, "actor_uses_technique"),
          eq(kgRelations.fromKind, "actor"),
          eq(kgRelations.toKind, "technique"),
          inArray(kgRelations.toId, params.techniqueIds)
        )
      )
      .limit(400);
    for (const r of rows) actorIds.add(r.actorId);
  }

  return Array.from(actorIds);
}

export async function dispatchWatchlistNotificationsForFindingId(db: Db, findingId: string) {
  const [finding] = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      epssScore: findings.epssScore,
      epssPercentile: findings.epssPercentile,
      epssUpdatedAt: findings.epssUpdatedAt,
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

  const cveId = finding.cveId ? String(finding.cveId).trim() : null;
  const techniqueIds = splitMitreIds(finding.mitreIds);
  const actorIds = await resolveActorIdsForFinding({ db, cveId, techniqueIds });

  // No signals -> nothing to match.
  if (!cveId && techniqueIds.length === 0 && actorIds.length === 0) return;

  const conds = [];
  if (cveId) conds.push(and(eq(watchlistItems.kind, "cve" as any), eq(watchlistItems.value, cveId)));
  if (techniqueIds.length) conds.push(and(eq(watchlistItems.kind, "technique" as any), inArray(watchlistItems.value, techniqueIds)));
  if (actorIds.length) conds.push(and(eq(watchlistItems.kind, "actor" as any), inArray(watchlistItems.value, actorIds)));

  if (!conds.length) return;

  const items = await db
    .select({
      id: watchlistItems.id,
      enabled: watchlistItems.enabled,
      projectId: watchlistItems.projectId,
      userId: watchlistItems.userId,
      kind: watchlistItems.kind,
      value: watchlistItems.value,
      channel: watchlistItems.channel,
      connectionId: watchlistItems.connectionId,
    })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.enabled, true), or(...conds)))
    .limit(500);

  if (!items.length) return;

  // Avoid double-sending for the same item+finding.
  const delivered = await db
    .select({ watchlistItemId: watchlistDeliveries.watchlistItemId })
    .from(watchlistDeliveries)
    .where(
      and(
        eq(watchlistDeliveries.findingId, findingId),
        inArray(
          watchlistDeliveries.watchlistItemId,
          items.map((i) => i.id)
        )
      )
    );
  const deliveredSet = new Set(delivered.map((d) => d.watchlistItemId));

  // Group matched items by destination (channel + connectionId + user/project) to reduce noise.
  const grouped = new Map<
    string,
    { channel: string; connectionId: string | null; userId: string; projectId: string; matches: Array<{ kind: string; value: string }>; itemIds: string[] }
  >();

  for (const it of items) {
    if (deliveredSet.has(it.id)) continue;
    const channel = String(it.channel);
    const connectionId = it.connectionId ? String(it.connectionId) : null;
    const key = `${it.userId}::${it.projectId}::${channel}::${connectionId ?? "email"}`;
    const cur =
      grouped.get(key) ?? {
        channel,
        connectionId,
        userId: it.userId,
        projectId: it.projectId,
        matches: [],
        itemIds: [],
      };
    cur.matches.push({ kind: String(it.kind), value: String(it.value) });
    cur.itemIds.push(it.id);
    grouped.set(key, cur);
  }

  if (!grouped.size) return;

  for (const g of grouped.values()) {
    const matches = g.matches;

    // Email delivery: record intent in alerts table (delivery handled elsewhere).
    if (g.channel === "email") {
      try {
        await db
          .insert(alerts)
          .values({ userId: g.userId, findingId, channel: "email", sentAt: new Date() })
          .onConflictDoNothing();
      } catch (err) {
        console.warn("[Watchlist] Failed to insert email alert record:", err);
      }

      // Mark each watchlist item as delivered for this finding to prevent repeated attempts.
      for (const itemId of g.itemIds) {
        await db
          .insert(watchlistDeliveries)
          .values({ watchlistItemId: itemId, findingId, status: "sent", sentAt: new Date() })
          .onConflictDoNothing();
      }
      continue;
    }

    const connId = g.connectionId;
    if (!connId) continue;

    if (g.channel === "slack") {
      const [conn] = await db
        .select({
          id: slackWebhookConnections.id,
          webhookUrl: slackWebhookConnections.webhookUrl,
          enabled: slackWebhookConnections.enabled,
        })
        .from(slackWebhookConnections)
        .where(
          and(
            eq(slackWebhookConnections.id, connId),
            eq(slackWebhookConnections.userId, g.userId),
            eq(slackWebhookConnections.projectId, g.projectId),
            eq(slackWebhookConnections.enabled, true)
          )
        )
        .limit(1);

      const href = safeExternalHref(String(conn?.webhookUrl ?? ""));
      if (!conn || !href) continue;

      const text = fmtSlackText({ finding, matches });
      try {
        const res = await fetch(href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const body = await res.text().catch(() => "");
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: res.ok ? "sent" : "failed",
              httpStatus: res.status,
              responseBody: body ? body.slice(0, 4000) : null,
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      } catch (err) {
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      }

      continue;
    }

    if (g.channel === "discord") {
      const [conn] = await db
        .select({
          id: discordWebhookConnections.id,
          webhookUrl: discordWebhookConnections.webhookUrl,
          enabled: discordWebhookConnections.enabled,
        })
        .from(discordWebhookConnections)
        .where(
          and(
            eq(discordWebhookConnections.id, connId),
            eq(discordWebhookConnections.userId, g.userId),
            eq(discordWebhookConnections.projectId, g.projectId),
            eq(discordWebhookConnections.enabled, true)
          )
        )
        .limit(1);

      const href = safeExternalHref(String(conn?.webhookUrl ?? ""));
      if (!conn || !href) continue;

      const content = fmtSlackText({ finding, matches });
      try {
        const res = await fetch(href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const body = await res.text().catch(() => "");
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: res.ok ? "sent" : "failed",
              httpStatus: res.status,
              responseBody: body ? body.slice(0, 4000) : null,
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      } catch (err) {
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      }

      continue;
    }

    if (g.channel === "soar") {
      const [conn] = await db
        .select({
          id: soarWebhookConnections.id,
          webhookUrl: soarWebhookConnections.webhookUrl,
          headers: soarWebhookConnections.headers,
          enabled: soarWebhookConnections.enabled,
        })
        .from(soarWebhookConnections)
        .where(
          and(
            eq(soarWebhookConnections.id, connId),
            eq(soarWebhookConnections.userId, g.userId),
            eq(soarWebhookConnections.projectId, g.projectId),
            eq(soarWebhookConnections.enabled, true)
          )
        )
        .limit(1);

      const href = safeExternalHref(String(conn?.webhookUrl ?? ""));
      if (!conn || !href) continue;

      const headers: Record<string, string> = { "content-type": "application/json" };
      const rawHeaders = conn.headers as any;
      if (rawHeaders && typeof rawHeaders === "object") {
        for (const [k, v] of Object.entries(rawHeaders)) {
          const kk = String(k ?? "").trim();
          const vv = String(v ?? "").trim();
          if (!kk || !vv) continue;
          headers[kk] = vv;
        }
      }

      const payload = buildSoarPayload({ finding, matches });
      try {
        const res = await fetch(href, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const body = await res.text().catch(() => "");
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: res.ok ? "sent" : "failed",
              httpStatus: res.status,
              responseBody: body ? body.slice(0, 4000) : null,
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      } catch (err) {
        for (const itemId of g.itemIds) {
          await db
            .insert(watchlistDeliveries)
            .values({
              watchlistItemId: itemId,
              findingId,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              sentAt: new Date(),
            })
            .onConflictDoNothing();
        }
      }

      continue;
    }

    // Unknown channel: treat as no-op and mark as errored so we don't loop.
    for (const itemId of g.itemIds) {
      await db
        .insert(watchlistDeliveries)
        .values({
          watchlistItemId: itemId,
          findingId,
          status: "error",
          error: `Unknown channel: ${g.channel}`,
          sentAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

}
