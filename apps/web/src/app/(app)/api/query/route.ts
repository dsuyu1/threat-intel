export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { KqlError, runKql } from "@ti/db";
import { getViewerContext } from "../../../../lib/tenancy";
import { allowedTablesForTier } from "../../../../lib/kql/allowedTables";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext();
  } catch {
    return jsonError("Unauthorized", 401);
  }
  if (process.env.NODE_ENV === "production" && !ctx.clerk.userId) return jsonError("Unauthorized", 401);
  const allowedTables = allowedTablesForTier(ctx.user.tier);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return jsonError("Missing query (q=...)", 400);
  try {
    const res = await runKql(q, { defaultLimit: 200, maxLimit: 2000, allowedTables, projectId: ctx.project.id });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof KqlError) return jsonError(err.message, 400, { pos: err.pos });
    return jsonError("Query failed", 500);
  }
}

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext();
  } catch {
    return jsonError("Unauthorized", 401);
  }
  if (process.env.NODE_ENV === "production" && !ctx.clerk.userId) return jsonError("Unauthorized", 401);
  const allowedTables = allowedTablesForTier(ctx.user.tier);
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const query = String(body?.query ?? "");
  if (!query.trim()) return jsonError("Missing query", 400);

  const debug = body?.debug === true;
  try {
    const res = await runKql(query, { defaultLimit: 200, maxLimit: 2000, debug, allowedTables, projectId: ctx.project.id });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof KqlError) return jsonError(err.message, 400, { pos: err.pos });
    return jsonError("Query failed", 500);
  }
}
