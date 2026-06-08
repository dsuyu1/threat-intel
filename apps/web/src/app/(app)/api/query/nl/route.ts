export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { KqlError, compileKqlToSql, getKqlTableSchemas, parseKql } from "@ti/db";
import { generateText, getAiProvider, getChatModel } from "../../../../../lib/ai";
import { allowedTablesForTier } from "../../../../../lib/kql/allowedTables";
import { buildNlqPrompt, detectRelativeTimeWindow, ensureTakeStage, parseNlqModelResponse } from "../../../../../lib/kql/nlq";
import { getViewerContext } from "../../../../../lib/tenancy";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext();
  } catch {
    return jsonError("Unauthorized", 401);
  }
  if (process.env.NODE_ENV === "production" && !ctx.clerk.userId) return jsonError("Unauthorized", 401);
  if (String(ctx.user.tier ?? "").toLowerCase() !== "pro") {
    return jsonError("Natural-language query is available on Pro.", 403);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const question = String(body?.question ?? "").trim();
  if (!question) return jsonError("Missing question", 400);

  const allowedTables = allowedTablesForTier(ctx.user.tier);
  const schemas = getKqlTableSchemas({ allowedTables });

  const now = new Date();
  const timeWindow = detectRelativeTimeWindow(question, now);

  const prompt = buildNlqPrompt({
    question,
    nowIso: now.toISOString(),
    allowedTables,
    schemas,
    timeWindow,
  });

  let raw = "";
  try {
    raw = await generateText({ prompt, temperature: 0.1, maxTokens: 900 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /OPENAI_API_KEY|GEMINI_API_KEY/i.test(msg) ? 400 : 500;
    return jsonError(msg, status);
  }

  const parsed = parseNlqModelResponse(raw);
  const kql = ensureTakeStage(parsed.kql, 50);
  const explanation = parsed.explanation;

  try {
    const ast = parseKql(kql);
    compileKqlToSql(ast, { defaultLimit: 200, maxLimit: 2000, allowedTables, projectId: ctx.project.id });
  } catch (err) {
    if (err instanceof KqlError) return jsonError(err.message, 422, { pos: err.pos });
    return jsonError("Failed to validate generated KQL", 500);
  }

  return NextResponse.json({
    kql,
    explanation,
    meta: {
      provider: getAiProvider(),
      model: getChatModel(),
      allowedTables,
      detectedTimeWindow: timeWindow ? { sinceIso: timeWindow.sinceIso, untilIso: timeWindow.untilIso } : null,
    },
  });
}
