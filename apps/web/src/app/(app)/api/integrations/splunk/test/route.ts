export const runtime = "edge";

import { getDb } from "@ti/db";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { getSplunkConnection } from "../../../../../../lib/splunk/client";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function normalizeBaseUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${pathname}`;
  } catch {
    return null;
  }
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

async function getServerInfo(params: { baseUrl: string; sessionKey: string }) {
  const base = params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`;
  const url = new URL("services/server/info", base);
  url.searchParams.set("output_mode", "json");
  const res = await fetch(url.toString(), {
    headers: { authorization: `Splunk ${params.sessionKey}` },
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) return { ok: false as const, status: res.status, data };
  return { ok: true as const, data };
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  let baseUrl = "";
  let username = "";
  let password = "";

  const id = String(body?.id ?? "").trim();
  if (id) {
    try {
      const res = await getSplunkConnection({ db, projectId: ctx.project.id, connectionId: id });
      if (!res.ok) return json({ error: res.error }, { status: 409 });
      baseUrl = res.connection.baseUrl;
      username = res.connection.username;
      password = res.connection.password;
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") return json({ error: "Splunk tables are missing. Run pnpm db:migrate." }, { status: 503 });
      throw err;
    }
  } else {
    baseUrl = normalizeBaseUrl(String(body?.baseUrl ?? "").trim()) ?? "";
    username = String(body?.username ?? "").trim();
    password = String(body?.password ?? "");
  }

  if (!baseUrl) return json({ error: "baseUrl is required" }, { status: 400 });
  if (!username) return json({ error: "username is required" }, { status: 400 });
  if (!password) return json({ error: "password is required" }, { status: 400 });

  let login;
  try {
    login = await getSessionKey({ baseUrl, username, password });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(
      {
        error:
          `Failed to reach Splunk at ${baseUrl}. ` +
          `If you're using a self-signed cert, Edge runtime can't bypass it — use HTTP or a trusted TLS cert. ` +
          `Details: ${msg}`,
      },
      { status: 502 }
    );
  }

  if (!login.ok) {
    return json({ error: `Splunk login failed (${login.status}). ${String(login.error).slice(0, 240)}` }, { status: 401 });
  }

  try {
    const info = await getServerInfo({ baseUrl, sessionKey: login.sessionKey });
    if (!info.ok) {
      return json({ error: `Splunk server info failed (${info.status}).`, details: info.data }, { status: 502 });
    }

    const entry = Array.isArray(info.data?.entry) ? info.data.entry[0] : null;
    const content = entry?.content ?? {};
    const server = {
      serverName: String(content?.serverName ?? content?.server_name ?? "") || null,
      version: String(content?.version ?? "") || null,
      build: String(content?.build ?? "") || null,
    };

    return json({ ok: true, server });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Splunk request failed. ${msg}` }, { status: 502 });
  }
}
