export const runtime = "edge";

/**
 * GET /api/findings
 *
 * Public: returns last 5 findings (teaser)
 * Pro subscribers: returns paginated full feed
 *
 * Query params:
 *   agent    = vuln | attack | ttp | exploit | malware
 *   severity = critical | high | medium | low
 *   page     = 1 (default)
 *   limit    = 20 (default, max 100 for pro)
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, findings, vulnScannerConnections, vulnScannerCveExposures } from "@ti/db";
import { desc, eq, and } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";

export async function GET(req: NextRequest) {
  let viewer: Awaited<ReturnType<typeof getViewerContext>> | null = null;
  try {
    viewer = await getViewerContext();
  } catch {
    viewer = null;
  }

  const isPro = viewer?.user.tier === "pro";

  const { searchParams } = req.nextUrl;
  const agent = searchParams.get("agent") as string | null;
  const severity = searchParams.get("severity") as string | null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const requestedLimit = parseInt(searchParams.get("limit") ?? "20");

  // Free tier: max 5 results, no filters
  const limit = isPro ? Math.min(requestedLimit, 100) : 5;
  const offset = isPro ? (page - 1) * limit : 0;

  const db = getDb();

  const conditions = [];
  if (agent && isPro) conditions.push(eq(findings.agent, agent as never));
  if (severity && isPro)
    conditions.push(eq(findings.severity, severity as never));

  let scannerConnectionId: string | null = null;
  if (isPro && viewer) {
    try {
      const [c] = await db
        .select({ id: vulnScannerConnections.id, lastSyncedAt: vulnScannerConnections.lastSyncedAt, updatedAt: vulnScannerConnections.updatedAt })
        .from(vulnScannerConnections)
        .where(and(eq(vulnScannerConnections.projectId, viewer.project.id), eq(vulnScannerConnections.enabled, true)))
        .orderBy(desc(vulnScannerConnections.lastSyncedAt), desc(vulnScannerConnections.updatedAt))
        .limit(1);
      scannerConnectionId = c?.id ?? null;
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code !== "42P01") {
        // Best-effort: if scanner tables exist but the query failed, don't take down the findings feed.
        console.warn("[/api/findings] Failed to load vuln scanner connection:", err);
      }
      scannerConnectionId = null;
    }
  }

  const includeExposure = Boolean(isPro && viewer && scannerConnectionId);

  let rows: any[] = [];
  try {
    let q: any = db
      .select({
        id: findings.id,
        agent: findings.agent,
        title: findings.title,
        summary: isPro ? findings.summary : findings.summary, // both see summary, teaser blurs in UI
        severity: findings.severity,
        cvssScore: findings.cvssScore,
        cveId: findings.cveId,
        tags: findings.tags,
        sourceUrl: isPro ? findings.sourceUrl : undefined,
        pocUrl: isPro ? findings.pocUrl : undefined,
        pocLevel: isPro ? findings.pocLevel : undefined,
        exposureAffectedHostCount: includeExposure ? vulnScannerCveExposures.affectedHostCount : undefined,
        exposureLastSeenAt: includeExposure ? vulnScannerCveExposures.lastSeenAt : undefined,
        publishedAt: findings.publishedAt,
      })
      .from(findings);

    if (includeExposure) {
      q = q.leftJoin(
        vulnScannerCveExposures,
        and(
          eq(vulnScannerCveExposures.projectId, viewer.project.id),
          eq(vulnScannerCveExposures.connectionId, scannerConnectionId),
          eq(vulnScannerCveExposures.cveId, findings.cveId)
        )
      );
    }

    rows = await q
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(findings.publishedAt))
      .limit(limit)
      .offset(offset);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      // DB may be behind migrations — fall back to the base query without scanner joins.
      rows = await db
        .select({
          id: findings.id,
          agent: findings.agent,
          title: findings.title,
          summary: isPro ? findings.summary : findings.summary,
          severity: findings.severity,
          cvssScore: findings.cvssScore,
          cveId: findings.cveId,
          tags: findings.tags,
          sourceUrl: isPro ? findings.sourceUrl : undefined,
          pocUrl: isPro ? findings.pocUrl : undefined,
          pocLevel: isPro ? findings.pocLevel : undefined,
          publishedAt: findings.publishedAt,
        })
        .from(findings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(findings.publishedAt))
        .limit(limit)
        .offset(offset);
    } else {
      throw err;
    }
  }

  return NextResponse.json({
    data: rows,
    meta: {
      page,
      limit,
      isPro,
    },
  });
}
