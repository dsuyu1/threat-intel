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
import { getDb, findings } from "@ti/db";
import { desc, eq, and } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  const isPro = await checkProTier(userId);

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

  const rows = await db
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
      publishedAt: findings.publishedAt,
    })
    .from(findings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(findings.publishedAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    meta: {
      page,
      limit,
      isPro,
    },
  });
}

async function checkProTier(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const db = getDb();
  const { users } = await import("@ti/db");
  const { eq } = await import("drizzle-orm");
  const [user] = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  return user?.tier === "pro";
}
