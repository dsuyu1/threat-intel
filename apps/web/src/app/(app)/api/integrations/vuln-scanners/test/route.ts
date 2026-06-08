export const runtime = "edge";

import { getDb, vulnScannerConnections } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { decryptSecret } from "../../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../../lib/tenancy";

type ScannerKind = "tenable" | "qualys" | "rapid7" | "openvas";

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

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function isScannerKind(v: string): v is ScannerKind {
  return v === "tenable" || v === "qualys" || v === "rapid7" || v === "openvas";
}

function basicAuthHeader(username: string, password: string) {
  const token = btoa(`${username}:${password}`);
  return `Basic ${token}`;
}

async function testTenable(params: { baseUrl: string; accessKey: string; secretKey: string }) {
  const url = new URL("/scans", params.baseUrl);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-ApiKeys": `accessKey=${params.accessKey}; secretKey=${params.secretKey}`,
      accept: "application/json",
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false as const, status: res.status, error: text || `HTTP ${res.status}` };
  return { ok: true as const };
}

async function testQualys(params: { baseUrl: string; username: string; password: string }) {
  const url = new URL("/api/2.0/fo/asset/host/vm/detection/", params.baseUrl);
  url.searchParams.set("action", "list");
  url.searchParams.set("truncation_limit", "1");
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(params.username, params.password),
      accept: "application/xml, text/xml, */*",
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false as const, status: res.status, error: text || `HTTP ${res.status}` };
  return { ok: true as const };
}

async function testRapid7(params: { baseUrl: string; apiKey?: string | null; username?: string | null; password?: string | null }) {
  const url = new URL("/api/3/assets", params.baseUrl);
  url.searchParams.set("page", "0");
  url.searchParams.set("size", "1");

  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = String(params.apiKey ?? "").trim();
  if (apiKey) headers["X-Api-Key"] = apiKey;
  else if (params.username && params.password) headers["authorization"] = basicAuthHeader(params.username, params.password);

  const res = await fetch(url.toString(), { method: "GET", headers });
  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false as const, status: res.status, error: text || `HTTP ${res.status}` };
  return { ok: true as const };
}

async function testOpenvas(params: { baseUrl: string; username: string; password: string }) {
  // OpenVAS/Greenbone deployments vary (GSA UI vs API-only vs reverse proxies). We keep this test lightweight:
  // ensure the base URL is reachable over HTTP(S). Full auth/data checks are handled by the sync agent.
  const url = new URL("/", params.baseUrl);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "text/html, application/json, */*",
      authorization: basicAuthHeader(params.username, params.password),
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false as const, status: res.status, error: text || `HTTP ${res.status}` };
  return { ok: true as const };
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Vulnerability scanner integrations are available on Pro." }, { status: 403 });

  let kind: ScannerKind | null = null;
  let baseUrl = "";
  let credentials: Record<string, string> = {};

  const id = String(body?.id ?? "").trim();
  if (id) {
    try {
      const [row] = await db
        .select({
          kind: vulnScannerConnections.kind,
          baseUrl: vulnScannerConnections.baseUrl,
          credentialsEnc: vulnScannerConnections.credentialsEnc,
        })
        .from(vulnScannerConnections)
        .where(and(eq(vulnScannerConnections.id, id), eq(vulnScannerConnections.projectId, ctx.project.id)))
        .limit(1);
      if (!row) return json({ error: "Connection not found" }, { status: 404 });
      kind = row.kind as any;
      baseUrl = row.baseUrl;
      const raw = await decryptSecret(row.credentialsEnc);
      credentials = (JSON.parse(raw) as any) ?? {};
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") return json({ error: "Scanner tables are missing. Run pnpm db:migrate." }, { status: 503 });
      return json({ error: `Failed to load connection. ${safeErrorMessage(err)}` }, { status: 500 });
    }
  } else {
    const kindRaw = String(body?.kind ?? "").trim().toLowerCase();
    if (!isScannerKind(kindRaw)) return json({ error: "kind must be 'tenable', 'qualys', 'rapid7', or 'openvas'" }, { status: 400 });
    kind = kindRaw;
    baseUrl = normalizeBaseUrl(String(body?.baseUrl ?? "").trim()) ?? "";
    credentials = (body?.credentials ?? {}) as any;
  }

  if (!kind) return json({ error: "kind is required" }, { status: 400 });
  if (!baseUrl) return json({ error: "baseUrl is required" }, { status: 400 });

  try {
    if (kind === "tenable") {
      const accessKey = String(credentials.accessKey ?? "").trim();
      const secretKey = String(credentials.secretKey ?? "").trim();
      if (!accessKey || !secretKey) return json({ error: "accessKey and secretKey are required" }, { status: 400 });
      const res = await testTenable({ baseUrl, accessKey, secretKey });
      if (!res.ok) return json({ error: `Tenable test failed (${res.status}). ${String(res.error).slice(0, 240)}` }, { status: 502 });
      return json({ ok: true });
    }

    if (kind === "qualys") {
      const username = String(credentials.username ?? "").trim();
      const password = String(credentials.password ?? "");
      if (!username || !password) return json({ error: "username and password are required" }, { status: 400 });
      const res = await testQualys({ baseUrl, username, password });
      if (!res.ok) return json({ error: `Qualys test failed (${res.status}). ${String(res.error).slice(0, 240)}` }, { status: 502 });
      return json({ ok: true });
    }

    if (kind === "rapid7") {
      const apiKey = String(credentials.apiKey ?? "").trim();
      const username = String(credentials.username ?? "").trim();
      const password = String(credentials.password ?? "");
      if (!apiKey && !(username && password)) return json({ error: "apiKey OR username/password are required" }, { status: 400 });
      const res = await testRapid7({ baseUrl, apiKey: apiKey || null, username: username || null, password: password || null });
      if (!res.ok) return json({ error: `Rapid7 test failed (${res.status}). ${String(res.error).slice(0, 240)}` }, { status: 502 });
      return json({ ok: true });
    }

    if (kind === "openvas") {
      const username = String(credentials.username ?? "").trim();
      const password = String(credentials.password ?? "");
      if (!username || !password) return json({ error: "username and password are required" }, { status: 400 });
      const res = await testOpenvas({ baseUrl, username, password });
      if (!res.ok) return json({ error: `OpenVAS test failed (${res.status}). ${String(res.error).slice(0, 240)}` }, { status: 502 });
      return json({ ok: true });
    }

    return json({ error: "Unsupported scanner kind" }, { status: 400 });
  } catch (err) {
    const msg =
      `Failed to reach scanner at ${baseUrl}. ` +
      `If you're using a self-signed cert, Edge runtime can't bypass it - use a trusted TLS cert. ` +
      `Details: ${safeErrorMessage(err)}`;
    return json({ error: msg }, { status: 502 });
  }
}
