export const runtime = "edge";

import { and, eq } from "drizzle-orm";
import { getDb, thehiveConnections } from "@ti/db";
import { decryptSecret } from "../../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../../lib/tenancy";

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

async function tryStatus(baseUrl: string, apiKey: string) {
  const endpoints = ["/api/v1/status", "/api/status"];
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8_000);

  try {
    let last: { status: number; body: string } | null = null;
    for (const path of endpoints) {
      const url = `${baseUrl}${path}`;
      const res = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const body = await res.text().catch(() => "");
      last = { status: res.status, body };
      if (res.ok) return { ok: true as const, url, status: res.status, body };
    }
    return { ok: false as const, ...(last ?? { status: 0, body: "" }) };
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const id = body?.id ? String(body.id).trim() : "";
  const baseUrlRaw = body?.baseUrl != null ? String(body.baseUrl).trim() : "";
  const apiKeyRaw = body?.apiKey != null ? String(body.apiKey).trim() : "";

  let baseUrl = baseUrlRaw ? normalizeBaseUrl(baseUrlRaw) : null;
  let apiKey = apiKeyRaw;

  if (id) {
    let row:
      | { baseUrl: string; apiKeyEnc: string }
      | undefined;
    try {
      [row] = await db
        .select({ baseUrl: thehiveConnections.baseUrl, apiKeyEnc: thehiveConnections.apiKeyEnc })
        .from(thehiveConnections)
        .where(
          and(
            eq(thehiveConnections.id, id),
            eq(thehiveConnections.projectId, viewer.project.id),
            eq(thehiveConnections.userId, viewer.user.id)
          )
        )
        .limit(1);
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") return json({ error: "TheHive tables are missing. Run pnpm db:migrate." }, { status: 503 });
      throw err;
    }
    if (!row) return json({ error: "Not found" }, { status: 404 });
    baseUrl = normalizeBaseUrl(row.baseUrl);
    try {
      apiKey = await decryptSecret(String(row.apiKeyEnc ?? ""));
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/TI_SECRETS_KEY is not set/i.test(msg)) return json({ error: msg }, { status: 500 });
      return json({ error: "Failed to decrypt API key" }, { status: 500 });
    }
  }

  if (!baseUrl) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });
  if (!apiKey) return json({ error: "apiKey is required" }, { status: 400 });

  const res = await tryStatus(baseUrl, apiKey);
  if (!res.ok) {
    return json(
      { error: `TheHive status check failed (HTTP ${res.status}).`, details: String(res.body ?? "").slice(0, 2000) },
      { status: 400 }
    );
  }

  return json({ ok: true, message: `Connected (${res.url}, HTTP ${res.status})` });
}
