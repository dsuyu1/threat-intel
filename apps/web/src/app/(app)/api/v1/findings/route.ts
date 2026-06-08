export const runtime = "edge";
export const dynamic = "force-dynamic";

import { findings, getDb } from "@ti/db";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../lib/api-auth";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function parseNumber(v: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "findings:read" });
  if (!auth.ok) return auth.res;

  const u = new URL(req.url);
  const q = u.searchParams.get("q")?.trim() ?? "";
  const agent = u.searchParams.get("agent")?.trim() ?? "";
  const cveId = u.searchParams.get("cveId")?.trim() ?? "";
  const minCvss = parseNumber(u.searchParams.get("minCvss"));
  const maxCvss = parseNumber(u.searchParams.get("maxCvss"));
  const since = parseDate(u.searchParams.get("since"));

  const limit = clamp(Number(u.searchParams.get("limit") ?? 50), 1, 200);
  const offset = clamp(Number(u.searchParams.get("offset") ?? 0), 0, 100_000);

  const conditions = [];
  if (q) {
    conditions.push(
      sql`${findings.title} ilike ${`%${q}%`} or ${findings.summary} ilike ${`%${q}%`} or ${findings.cveId} ilike ${`%${q}%`} or ${findings.sourceUrl} ilike ${`%${q}%`} or ${findings.pocUrl} ilike ${`%${q}%`}`
    );
  }
  if (agent) conditions.push(eq(findings.agent, agent as never));
  if (cveId) conditions.push(eq(findings.cveId, cveId));
  if (minCvss != null) conditions.push(sql`${findings.cvssScore} >= ${minCvss}`);
  if (maxCvss != null) conditions.push(sql`${findings.cvssScore} <= ${maxCvss}`);
  if (since) {
    const when = sql<Date>`coalesce(${findings.publishedAt}, ${findings.createdAt})`;
    conditions.push(gte(when, since));
  }
  const whereExpr = conditions.length ? (and(...conditions) as any) : undefined;

  // Group PoC entries by CVE to prevent one CVE drowning out everything else.
  const groupKey = sql<string>`case when ${findings.agent} = 'exploit' and ${findings.cveId} is not null then ${findings.cveId} else ${findings.id}::text end`;
  const orderByAgg = sql`order by ${findings.publishedAt} desc nulls last, ${findings.createdAt} desc, ${findings.id} desc`;
  const idAgg = sql<string>`((array_agg(${findings.id} ${orderByAgg}))[1])::text`;
  const titleAgg = sql<string>`(array_agg(${findings.title} ${orderByAgg}))[1]`;
  const summaryAgg = sql<string | null>`(array_agg(${findings.summary} ${orderByAgg}))[1]`;
  const agentAgg = sql<string>`(max(${findings.agent}))::text`;
  const cveIdAgg = sql<string | null>`max(${findings.cveId})`;
  const cvssScoreAgg = sql<number | null>`max(${findings.cvssScore})`;
  const cvssScoreTextAgg = sql<string | null>`(max(${findings.cvssScore}))::text`;
  const severityAgg = sql<string>`case
    when max(${findings.cvssScore}) >= 9 then 'critical'
    when max(${findings.cvssScore}) >= 7 then 'high'
    when max(${findings.cvssScore}) >= 4 then 'medium'
    when max(${findings.cvssScore}) is not null then 'low'
    else 'info'
  end`;
  const urlAgg = sql<string | null>`(array_agg(coalesce(${findings.pocUrl}, ${findings.sourceUrl}) ${orderByAgg}))[1]`;
  const publishedAtAgg = sql<Date | null>`max(${findings.publishedAt})`;
  const createdAtAgg = sql<Date | null>`max(${findings.createdAt})`;
  const pocCountAgg = sql<number>`(count(*) filter (where ${findings.pocUrl} is not null))::int`;

  const db = getDb();
  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${groupKey})` })
    .from(findings)
    .where(whereExpr);

  const rows = await db
    .select({
      id: idAgg,
      title: titleAgg,
      summary: summaryAgg,
      agent: agentAgg,
      cveId: cveIdAgg,
      cvssScore: cvssScoreTextAgg,
      severity: severityAgg,
      sourceUrl: urlAgg,
      publishedAt: publishedAtAgg,
      createdAt: createdAtAgg,
      pocCount: pocCountAgg,
    })
    .from(findings)
    .where(whereExpr)
    .groupBy(groupKey)
    .orderBy(desc(publishedAtAgg), desc(createdAtAgg), asc(groupKey))
    .limit(limit)
    .offset(offset);

  return json({
    ok: true,
    total: Number(total ?? 0),
    limit,
    offset,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? null,
      agent: r.agent,
      cveId: r.cveId ?? null,
      cvssScore: r.cvssScore ? String(r.cvssScore) : null,
      severity: r.severity,
      sourceUrl: r.sourceUrl ?? null,
      publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      pocCount: Number(r.pocCount ?? 0),
    })),
  });
}
