export const runtime = "edge";

import { getDb, navigatorDetections, navigatorScenarios } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { createOrUpdateSavedSearch, defaultSavedSearchName, getSplunkConnection } from "../../../../../../lib/splunk/client";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingDetectionsTable(err: unknown) {
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

  const optionsRaw = (body?.options ?? {}) as any;
  const requestedName = String(body?.name ?? optionsRaw?.name ?? "").trim();

  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });

  const enabled = optionsRaw?.enabled == null ? true : Boolean(optionsRaw.enabled);
  const isScheduled = Boolean(optionsRaw?.isScheduled);
  const cronSchedule = String(optionsRaw?.cronSchedule ?? "").trim();
  const earliestTime = String(optionsRaw?.earliestTime ?? "").trim();
  const latestTime = String(optionsRaw?.latestTime ?? "").trim();
  const additionalParamsIn = optionsRaw?.additionalParams as any;

  if (isScheduled && !cronSchedule) {
    return json({ error: "cronSchedule is required when isScheduled is true" }, { status: 400 });
  }

  let additionalParams: Record<string, string> | undefined;
  if (additionalParamsIn && typeof additionalParamsIn === "object") {
    additionalParams = {};
    for (const [k, v] of Object.entries(additionalParamsIn)) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      const value = String(v ?? "").trim();
      if (!value) continue;
      additionalParams[key] = value.slice(0, 4000);
    }
  }

  let detection:
    | { content: string; techniqueName: string | null; lifecycleStatus: string }
    | null = null;
  try {
    const [row] = await db
      .select({
        content: navigatorDetections.content,
        techniqueName: navigatorDetections.techniqueName,
        lifecycleStatus: navigatorDetections.lifecycleStatus,
      })
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

    detection = row?.content
      ? { content: row.content, techniqueName: row.techniqueName ?? null, lifecycleStatus: String(row.lifecycleStatus ?? "draft") }
      : null;
  } catch (err) {
    if (isMissingDetectionsTable(err)) return json({ error: "Detections tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!detection) return json({ error: "No cached SPL detection found. Generate detections first." }, { status: 409 });

  if (detection.lifecycleStatus === "retired") {
    return json({ error: "This detection is retired. Set it back to draft/peer-reviewed before deploying." }, { status: 409 });
  }
  if (detection.lifecycleStatus === "draft") {
    return json({ error: "This detection is still draft. Mark it peer-reviewed before deploying." }, { status: 409 });
  }

  let scenarioTitle: string | null = null;
  try {
    const [row] = await db
      .select({ title: navigatorScenarios.title })
      .from(navigatorScenarios)
      .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
      .limit(1);
    scenarioTitle = row?.title ?? null;
  } catch {
    scenarioTitle = null;
  }

  let connectionRes;
  try {
    connectionRes = await getSplunkConnection({ db, projectId: ctx.project.id, connectionId });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!connectionRes.ok) return json({ error: connectionRes.error }, { status: 409 });

  const techniqueName = detection.techniqueName ?? techniqueId;
  const savedSearchName =
    requestedName ||
    defaultSavedSearchName({
      scenarioTitle,
      techniqueId,
      techniqueName,
    });

  const descriptionParts = [
    "Threat Intel Navigator detection",
    scenarioTitle ? `Scenario: ${scenarioTitle}` : null,
    `Technique: ${techniqueId}${techniqueName ? ` - ${techniqueName}` : ""}`,
  ].filter(Boolean);

  let result;
  try {
    result = await createOrUpdateSavedSearch({
      connection: connectionRes.connection,
      name: savedSearchName,
      search: detection.content,
      description: descriptionParts.join(" | ").slice(0, 240),
      options: { enabled, isScheduled, cronSchedule, earliestTime, latestTime, additionalParams },
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

  if (!result.ok) {
    return json({ error: `Splunk push failed (${result.status}). ${String(result.error).slice(0, 240)}` }, { status: 502 });
  }

  // Best-effort lifecycle update: successful push means it's deployed.
  try {
    const now = new Date();
    await db
      .update(navigatorDetections)
      .set({ lifecycleStatus: "deployed" as any, deployedAt: now, retiredAt: null, updatedAt: now })
      .where(
        and(
          eq(navigatorDetections.projectId, ctx.project.id),
          eq(navigatorDetections.scenarioId, scenarioId),
          eq(navigatorDetections.techniqueId, techniqueId),
          eq(navigatorDetections.format, "spl")
        )
      );
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01" && code !== "42703") throw err;
  }

  return json({
    ok: true,
    savedSearch: {
      name: savedSearchName,
      created: result.created,
      owner: connectionRes.connection.owner,
      app: connectionRes.connection.app,
      connectionName: connectionRes.connection.name,
    },
  });
}
