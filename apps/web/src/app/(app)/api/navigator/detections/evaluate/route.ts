export const runtime = "edge";

import { getDb, navigatorDetections } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { getSplunkConnection, runSplunkMatchCount } from "../../../../../../lib/splunk/client";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "");
  const msg = String(anyErr?.message ?? err ?? "");
  return code === "42P01" || msg.includes("navigator_detections") || msg.includes('relation "navigator_detections"');
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const scenarioId = String(body?.scenarioId ?? "").trim();
  const techniqueId = String(body?.techniqueId ?? "").trim();
  const connectionId = String(body?.connectionId ?? "").trim();
  const earliestTime = String(body?.earliestTime ?? "").trim();
  const latestTime = String(body?.latestTime ?? "").trim();

  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });

  let detection: { content: string } | null = null;
  try {
    const [row] = await db
      .select({ content: navigatorDetections.content })
      .from(navigatorDetections)
      .where(
        and(
          eq(navigatorDetections.projectId, ctx.project.id),
          eq(navigatorDetections.scenarioId, scenarioId),
          eq(navigatorDetections.techniqueId, techniqueId),
          eq(navigatorDetections.format, "spl")
        )
      )
      .orderBy(desc(navigatorDetections.updatedAt))
      .limit(1);
    detection = row?.content ? { content: row.content } : null;
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Detections tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!detection) return json({ error: "No cached SPL detection found. Generate detections first." }, { status: 409 });

  let connectionRes;
  try {
    connectionRes = await getSplunkConnection({ db, projectId: ctx.project.id, connectionId });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!connectionRes.ok) return json({ error: connectionRes.error }, { status: 409 });

  let result;
  try {
    result = await runSplunkMatchCount({
      connection: connectionRes.connection,
      search: detection.content,
      earliestTime: earliestTime || null,
      latestTime: latestTime || null,
    });
  } catch (err) {
    return json(
      {
        error:
          `Failed to reach Splunk at ${connectionRes.connection.baseUrl}. ` +
          `If you're using a self-signed cert, Edge runtime can't bypass it - use HTTP or a trusted TLS cert. ` +
          `Details: ${safeErrorMessage(err)}`,
      },
      { status: 502 }
    );
  }

  if (!result.ok) return json({ error: `Splunk search failed (${result.status}). ${String(result.error).slice(0, 240)}` }, { status: 502 });

  // Best-effort lifecycle update: if a detection was deployed and we are actively evaluating it, it's in monitoring.
  try {
    const now = new Date();
    await db
      .update(navigatorDetections)
      .set({ lifecycleStatus: "monitoring" as any, updatedAt: now })
      .where(
        and(
          eq(navigatorDetections.projectId, ctx.project.id),
          eq(navigatorDetections.scenarioId, scenarioId),
          eq(navigatorDetections.techniqueId, techniqueId),
          eq(navigatorDetections.format, "spl"),
          eq(navigatorDetections.lifecycleStatus, "deployed" as any)
        )
      );
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01" && code !== "42703") throw err;
  }

  return json({
    ok: true,
    matchCount: result.matchCount,
    matchesPerDay: result.matchesPerDay,
    windowDaysEstimated: result.windowDaysEstimated,
  });
}
