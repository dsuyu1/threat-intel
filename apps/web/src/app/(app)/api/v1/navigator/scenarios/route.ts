export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiKey } from "../../../../../../lib/api-auth";

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

const VALIDATION = ["unvalidated", "in_progress", "validated", "not_applicable"] as const;

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "navigator:read" });
  if (!auth.ok) return auth.res;

  const u = new URL(req.url);
  const statusRaw = u.searchParams.getAll("validationStatus").flatMap((s) => String(s).split(","));
  const status = statusRaw
    .map((s) => String(s).trim())
    .filter((s) => (VALIDATION as readonly string[]).includes(s));

  const limit = clamp(Number(u.searchParams.get("limit") ?? 50), 1, 200);
  const offset = clamp(Number(u.searchParams.get("offset") ?? 0), 0, 100_000);

  const conditions = [eq(navigatorScenarios.projectId, auth.apiKey.projectId)];
  if (status.length) conditions.push(inArray(navigatorScenarios.validationStatus, status as any));
  const whereExpr = and(...conditions);

  const db = getDb();
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(navigatorScenarios)
    .where(whereExpr);

  const rows = await db
    .select({
      id: navigatorScenarios.id,
      scenarioKey: navigatorScenarios.scenarioKey,
      scenarioType: navigatorScenarios.scenarioType,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      score: navigatorScenarios.score,
      validationStatus: navigatorScenarios.validationStatus,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(whereExpr)
    .orderBy(desc(navigatorScenarios.score), desc(navigatorScenarios.computedAt), asc(navigatorScenarios.id))
    .limit(limit)
    .offset(offset);

  return json({
    ok: true,
    total: Number(total ?? 0),
    limit,
    offset,
    rows: rows.map((r) => ({
      id: r.id,
      scenarioKey: r.scenarioKey,
      scenarioType: String(r.scenarioType),
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      targetKind: r.targetKind,
      targetId: r.targetId,
      targetName: r.targetName ?? null,
      title: r.title,
      summary: r.summary ?? null,
      score: Number(r.score ?? 0),
      validationStatus: String(r.validationStatus),
      computedAt: r.computedAt ? new Date(r.computedAt).toISOString() : null,
    })),
  });
}
