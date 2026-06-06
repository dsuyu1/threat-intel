export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { KqlError, runKql } from "@ti/db";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return jsonError("Missing query (q=...)", 400);
  try {
    const res = await runKql(q, { defaultLimit: 200, maxLimit: 2000 });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof KqlError) return jsonError(err.message, 400, { pos: err.pos });
    return jsonError("Query failed", 500);
  }
}

export async function POST(req: NextRequest) {
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
    const res = await runKql(query, { defaultLimit: 200, maxLimit: 2000, debug });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof KqlError) return jsonError(err.message, 400, { pos: err.pos });
    return jsonError("Query failed", 500);
  }
}

