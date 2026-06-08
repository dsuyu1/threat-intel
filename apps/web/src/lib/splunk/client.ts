import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as schema from "@ti/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { splunkConnections } from "@ti/db";
import { decryptSecret, encryptSecret } from "../secretbox";

export type Db = NeonHttpDatabase<typeof schema>;

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

export async function getSplunkSessionKey(params: { baseUrl: string; username: string; password: string }) {
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

export function defaultSavedSearchName(params: { scenarioTitle: string | null; techniqueId: string; techniqueName: string }) {
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

function looksEncryptedSecretPayload(value: string) {
  const s = String(value ?? "");
  if (!s.startsWith("v1:")) return false;
  const parts = s.split(":");
  if (parts.length !== 3) return false;
  const iv = parts[1] ?? "";
  const ct = parts[2] ?? "";
  if (!iv || !ct) return false;
  const b64 = /^[A-Za-z0-9+/=]+$/;
  return b64.test(iv) && b64.test(ct);
}

export async function createOrUpdateSavedSearch(params: {
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
  const login = await getSplunkSessionKey({
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

export async function getSplunkConnection(params: { db: Db; projectId: string; connectionId?: string | null }) {
  const connectionId = String(params.connectionId ?? "").trim();

  let connection:
    | {
        id: string;
        baseUrl: string;
        owner: string;
        app: string;
        username: string;
        password: string;
        name: string;
        enabled: boolean;
      }
    | undefined;

  if (connectionId) {
    [connection] = await params.db
      .select({
        id: splunkConnections.id,
        baseUrl: splunkConnections.baseUrl,
        owner: splunkConnections.owner,
        app: splunkConnections.app,
        username: splunkConnections.username,
        password: splunkConnections.password,
        name: splunkConnections.name,
        enabled: splunkConnections.enabled,
      })
      .from(splunkConnections)
      .where(and(eq(splunkConnections.id, connectionId), eq(splunkConnections.projectId, params.projectId)))
      .limit(1);
  } else {
    [connection] = await params.db
      .select({
        id: splunkConnections.id,
        baseUrl: splunkConnections.baseUrl,
        owner: splunkConnections.owner,
        app: splunkConnections.app,
        username: splunkConnections.username,
        password: splunkConnections.password,
        name: splunkConnections.name,
        enabled: splunkConnections.enabled,
      })
      .from(splunkConnections)
      .where(and(eq(splunkConnections.projectId, params.projectId), eq(splunkConnections.enabled, true)))
      .orderBy(desc(splunkConnections.updatedAt), desc(splunkConnections.createdAt))
      .limit(1);
  }

  if (!connection) {
    if (connectionId) return { ok: false as const, error: "Splunk connection not found." };
    return { ok: false as const, error: "No enabled Splunk connections found. Go to Connections -> Splunk." };
  }
  if (connectionId && !connection.enabled) return { ok: false as const, error: "Selected Splunk connection is disabled." };

  const passwordRaw = String(connection.password ?? "");

  if (looksEncryptedSecretPayload(passwordRaw)) {
    try {
      const password = await decryptSecret(passwordRaw);
      return { ok: true as const, connection: { ...connection, password } };
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/TI_SECRETS_KEY is not set/i.test(msg)) {
        return { ok: false as const, error: "TI_SECRETS_KEY is not set (required to decrypt Splunk credentials safely)." };
      }
      return { ok: false as const, error: "Failed to decrypt Splunk password. Re-save the connection in Connections -> Splunk." };
    }
  }

  // Legacy plaintext: return it, but opportunistically migrate to encrypted-at-rest.
  try {
    const passwordEnc = await encryptSecret(passwordRaw);
    await params.db
      .update(splunkConnections)
      .set({ password: passwordEnc })
      .where(and(eq(splunkConnections.id, connection.id), eq(splunkConnections.projectId, params.projectId)));
  } catch {
    // ignore
  }

  return { ok: true as const, connection };
}

function tryParseDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function estimateWindowDays(params: { earliestTime: string; latestTime: string }): number | null {
  const earliest = params.earliestTime.trim();
  const latest = params.latestTime.trim();

  if (earliest) {
    const mDays = earliest.match(/^-([0-9]+)d$/i);
    if (mDays?.[1]) return Math.max(0.01, Number(mDays[1]));
    const mHours = earliest.match(/^-([0-9]+)h$/i);
    if (mHours?.[1]) return Math.max(0.01, Number(mHours[1]) / 24);
  }

  const e = earliest ? tryParseDate(earliest) : null;
  const l = latest && latest !== "now" ? tryParseDate(latest) : new Date();
  if (!e || !l) return null;
  const ms = l.getTime() - e.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(0.01, ms / (24 * 60 * 60 * 1000));
}

export async function runSplunkMatchCount(params: {
  connection: { baseUrl: string; username: string; password: string };
  search: string;
  earliestTime?: string | null;
  latestTime?: string | null;
}): Promise<
  | { ok: true; matchCount: number; matchesPerDay: number; windowDaysEstimated: number | null }
  | { ok: false; status: number; error: string }
> {
  const login = await getSplunkSessionKey({
    baseUrl: params.connection.baseUrl,
    username: params.connection.username,
    password: params.connection.password,
  });

  if (!login.ok) return { ok: false, status: login.status, error: String(login.error) };

  const base = params.connection.baseUrl.endsWith("/") ? params.connection.baseUrl : `${params.connection.baseUrl}/`;
  const url = new URL("services/search/jobs/export", base);
  url.searchParams.set("output_mode", "json");

  const earliestTime = String(params.earliestTime ?? "").trim();
  const latestTime = String(params.latestTime ?? "").trim();

  const search = `${String(params.search ?? "").trim()} | stats count as matchCount`;

  const body = new URLSearchParams();
  body.set("search", search);
  if (earliestTime) body.set("earliest_time", earliestTime);
  if (latestTime) body.set("latest_time", latestTime);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Splunk ${login.sessionKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, status: res.status, error: text || `Search failed (${res.status})` };

  let matchCount = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as any;
      const result = obj?.result ?? obj?.results?.[0] ?? null;
      const raw = result?.matchCount ?? result?.matchcount ?? result?.count ?? null;
      if (raw != null) {
        matchCount = Number(raw) || 0;
        break;
      }
    } catch {
      // ignore
    }
  }

  const windowDaysEstimated = estimateWindowDays({
    earliestTime,
    latestTime: latestTime || "now",
  });
  const denom = windowDaysEstimated ?? 1;
  const matchesPerDay = matchCount / denom;

  return { ok: true, matchCount, matchesPerDay, windowDaysEstimated };
}
