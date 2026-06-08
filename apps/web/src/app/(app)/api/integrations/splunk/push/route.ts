export const runtime = "edge";

import { getDb, navigatorScenarios } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { createOrUpdateSavedSearch, defaultSavedSearchName, getSplunkConnection } from "../../../../../../lib/splunk/client";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const scenarioId = String(body?.scenarioId ?? "").trim();
  const techniqueId = String(body?.techniqueId ?? "").trim();
  const techniqueName = String(body?.techniqueName ?? "").trim();
  const content = String(body?.content ?? "").trim();
  const optionsRaw = (body?.options ?? {}) as any;
  const requestedName = String(body?.name ?? optionsRaw?.name ?? "").trim();
  const connectionId = String(body?.connectionId ?? "").trim();

  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });
  if (!content) return json({ error: "content is required" }, { status: 400 });

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

  let scenarioTitle: string | null = null;
  try {
      const [sc] = await db
        .select({ title: navigatorScenarios.title })
        .from(navigatorScenarios)
      .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
        .limit(1);
    scenarioTitle = sc?.title ?? null;
  } catch {
    scenarioTitle = null;
  }

  let connection:
    | {
        baseUrl: string;
        owner: string;
        app: string;
        username: string;
        password: string;
        name: string;
        enabled: boolean;
      }
    | undefined;

  try {
    const res = await getSplunkConnection({ db, projectId: ctx.project.id, connectionId });
    if (!res.ok) return json({ error: res.error }, { status: 409 });
    connection = res.connection;
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

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
      connection,
      name: savedSearchName,
      search: content,
      description: descriptionParts.join(" | ").slice(0, 240),
      options: { enabled, isScheduled, cronSchedule, earliestTime, latestTime, additionalParams },
    });
  } catch (err) {
    return json(
      {
        error:
          `Failed to reach Splunk at ${connection.baseUrl}. ` +
          `If you're using a self-signed cert, Edge runtime can't bypass it - use HTTP or a trusted TLS cert. ` +
          `Details: ${safeErrorMessage(err)}`,
      },
      { status: 502 }
    );
  }

  if (!result.ok) {
    return json({ error: `Splunk push failed (${result.status}). ${String(result.error).slice(0, 240)}` }, { status: 502 });
  }

  return json({
    ok: true,
    savedSearch: {
      name: savedSearchName,
      created: result.created,
      owner: connection.owner,
      app: connection.app,
      connectionName: connection.name,
    },
  });
}
