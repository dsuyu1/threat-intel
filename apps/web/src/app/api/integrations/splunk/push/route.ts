export const runtime = "edge";

import { getDb, navigatorScenarios, splunkConnections } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../lib/tenancy";

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

function extractSessionKey(text: string) {
  const xml = text.match(/<sessionKey>([^<]+)<\/sessionKey>/i);
  if (xml?.[1]) return xml[1];
  try {
    const obj = JSON.parse(text) as any;
    if (typeof obj?.sessionKey === "string" && obj.sessionKey) return obj.sessionKey;
    const entry = Array.isArray(obj?.entry) ? obj.entry[0] : null;
    const content = entry?.content ?? null;
    if (typeof content?.sessionKey === "string" && content.sessionKey) return content.sessionKey;
  } catch {
    // ignore
  }
  return null;
}

async function getSessionKey(params: { baseUrl: string; username: string; password: string }) {
  const base = params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`;
  const url = new URL("services/auth/login", base);
  url.searchParams.set("output_mode", "json");

  const body = new URLSearchParams({ username: params.username, password: params.password });
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false as const, status: res.status, error: text || `Login failed (${res.status})` };
  }

  const sessionKey = extractSessionKey(text);
  if (!sessionKey) return { ok: false as const, status: res.status, error: "Failed to parse Splunk session key" };
  return { ok: true as const, sessionKey };
}

function clamp(str: string, max: number) {
  const s = String(str ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function defaultSavedSearchName(params: { scenarioTitle: string | null; techniqueId: string; techniqueName: string }) {
  const head = params.scenarioTitle ? clamp(params.scenarioTitle, 48) : "Navigator";
  const techName = params.techniqueName ? clamp(params.techniqueName, 42) : "";
  const parts = ["TI", head, params.techniqueId, techName].filter(Boolean);
  return clamp(parts.join(" - "), 120);
}

function safeKey(s: string) {
  const key = String(s ?? "").trim();
  if (!key) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(key)) return null;
  return key;
}

async function createOrUpdateSavedSearch(params: {
  connection: {
    baseUrl: string;
    owner: string;
    app: string;
    username: string;
    password: string;
  };
  name: string;
  search: string;
  description: string;
  options?: {
    enabled?: boolean;
    isScheduled?: boolean;
    cronSchedule?: string;
    earliestTime?: string;
    latestTime?: string;
    additionalParams?: Record<string, string>;
  };
}) {
  const login = await getSessionKey({
    baseUrl: params.connection.baseUrl,
    username: params.connection.username,
    password: params.connection.password,
  });

  if (!login.ok) return { ok: false as const, status: login.status, error: String(login.error) };

  const base = params.connection.baseUrl.endsWith("/") ? params.connection.baseUrl : `${params.connection.baseUrl}/`;
  const owner = encodeURIComponent(params.connection.owner);
  const app = encodeURIComponent(params.connection.app);
  const basePath = `servicesNS/${owner}/${app}/saved/searches`;

  const createUrl = new URL(basePath, base);
  createUrl.searchParams.set("output_mode", "json");

  const o = params.options ?? {};
  const isScheduled = Boolean(o.isScheduled);
  const enabled = o.enabled == null ? true : Boolean(o.enabled);
  const earliestTime = String(o.earliestTime ?? "").trim();
  const latestTime = String(o.latestTime ?? "").trim();
  const cronSchedule = String(o.cronSchedule ?? "").trim();

  const createBody = new URLSearchParams();
  createBody.set("name", params.name);
  createBody.set("search", params.search);
  createBody.set("description", params.description);
  createBody.set("is_scheduled", isScheduled ? "1" : "0");
  createBody.set("disabled", enabled ? "0" : "1");
  if (isScheduled && cronSchedule) createBody.set("cron_schedule", cronSchedule);
  if (earliestTime) createBody.set("dispatch.earliest_time", earliestTime);
  if (latestTime) createBody.set("dispatch.latest_time", latestTime);

  const reserved = new Set([
    "name",
    "search",
    "description",
    "is_scheduled",
    "cron_schedule",
    "disabled",
    "dispatch.earliest_time",
    "dispatch.latest_time",
    "output_mode",
  ]);

  if (o.additionalParams && typeof o.additionalParams === "object") {
    for (const [k, v] of Object.entries(o.additionalParams)) {
      const key = safeKey(k);
      if (!key) continue;
      if (reserved.has(key)) continue;
      const value = String(v ?? "").trim();
      if (!value) continue;
      createBody.set(key, value.slice(0, 4000));
    }
  }

  const res = await fetch(createUrl.toString(), {
    method: "POST",
    headers: {
      authorization: `Splunk ${login.sessionKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: createBody,
  });

  if (res.ok) return { ok: true as const, created: true };

  const text = await res.text().catch(() => "");
  const mightExist =
    res.status === 409 || /already exists/i.test(text) || (res.status === 400 && /exists/i.test(text));

  if (!mightExist) return { ok: false as const, status: res.status, error: text || `Create failed (${res.status})` };

  const updateUrl = new URL(`${basePath}/${encodeURIComponent(params.name)}`, base);
  updateUrl.searchParams.set("output_mode", "json");

  const updateBody = new URLSearchParams();
  updateBody.set("search", params.search);
  updateBody.set("description", params.description);
  updateBody.set("is_scheduled", isScheduled ? "1" : "0");
  updateBody.set("disabled", enabled ? "0" : "1");
  if (isScheduled && cronSchedule) updateBody.set("cron_schedule", cronSchedule);
  if (earliestTime) updateBody.set("dispatch.earliest_time", earliestTime);
  if (latestTime) updateBody.set("dispatch.latest_time", latestTime);

  if (o.additionalParams && typeof o.additionalParams === "object") {
    for (const [k, v] of Object.entries(o.additionalParams)) {
      const key = safeKey(k);
      if (!key) continue;
      if (reserved.has(key)) continue;
      const value = String(v ?? "").trim();
      if (!value) continue;
      updateBody.set(key, value.slice(0, 4000));
    }
  }

  const upd = await fetch(updateUrl.toString(), {
    method: "POST",
    headers: {
      authorization: `Splunk ${login.sessionKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: updateBody,
  });

  const updText = await upd.text().catch(() => "");
  if (!upd.ok) return { ok: false as const, status: upd.status, error: updText || `Update failed (${upd.status})` };
  return { ok: true as const, created: false };
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
      const key = safeKey(k);
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
    if (connectionId) {
      [connection] = await db
        .select({
          baseUrl: splunkConnections.baseUrl,
          owner: splunkConnections.owner,
          app: splunkConnections.app,
          username: splunkConnections.username,
          password: splunkConnections.password,
          name: splunkConnections.name,
          enabled: splunkConnections.enabled,
        })
        .from(splunkConnections)
        .where(and(eq(splunkConnections.id, connectionId), eq(splunkConnections.projectId, ctx.project.id)))
        .limit(1);
    } else {
      [connection] = await db
        .select({
          baseUrl: splunkConnections.baseUrl,
          owner: splunkConnections.owner,
          app: splunkConnections.app,
          username: splunkConnections.username,
          password: splunkConnections.password,
          name: splunkConnections.name,
          enabled: splunkConnections.enabled,
        })
        .from(splunkConnections)
        .where(and(eq(splunkConnections.projectId, ctx.project.id), eq(splunkConnections.enabled, true)))
        .orderBy(desc(splunkConnections.updatedAt), desc(splunkConnections.createdAt))
        .limit(1);
    }
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (connectionId && connection && !connection.enabled) {
    return json({ error: "Selected Splunk connection is disabled." }, { status: 409 });
  }

  if (!connection) {
    return json({ error: "No enabled Splunk connections found. Go to Connections -> Splunk." }, { status: 409 });
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
      description: clamp(descriptionParts.join(" | "), 240),
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
