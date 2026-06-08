export const runtime = "edge";

import { getDb, sources } from "@ti/db";
import { eq } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function safeExternalHref(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function clamp01(value: unknown) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function defaultNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host || url;
  } catch {
    return url;
  }
}

export async function POST(req: Request) {
  try {
    await getViewerContext(); // auth guard (sources are global)
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const body = (await req.json().catch(() => null)) as any;

  const typeRaw = String(body?.type ?? "").trim().toLowerCase();
  const type = typeRaw === "stix" ? "stix" : typeRaw === "rss" ? "rss" : null;

  const urlRaw = String(body?.url ?? "").trim();
  const url = safeExternalHref(urlRaw);

  const nameRaw = String(body?.name ?? "").trim();
  const name = nameRaw || (url ? defaultNameFromUrl(url) : "");

  const enabled = body?.enabled == null ? true : Boolean(body.enabled);
  const reliabilityRaw = clamp01(body?.reliability);
  const reliability = reliabilityRaw ?? (type === "stix" ? 1 : 0.9);

  if (!type) return json({ error: "type must be 'rss' or 'stix'" }, { status: 400 });
  if (!url) return json({ error: "url must be a valid http(s) URL" }, { status: 400 });
  if (!name) return json({ error: "name is required" }, { status: 400 });

  try {
    const [row] = await db
      .insert(sources)
      .values({
        type: type as any,
        name,
        url,
        enabled,
        reliability,
        lastFetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: sources.id, url: sources.url });

    if (!row?.id) return json({ error: "Failed to create source" }, { status: 500 });
    return json({ ok: true, source: row });
  } catch (err) {
    const anyErr = err as any;
    const code = String(anyErr?.code ?? "");
    if (code === "42P01") return json({ error: "Sources tables are missing. Run pnpm db:migrate." }, { status: 503 });
    if (code === "23505") {
      const [existing] = await db.select({ id: sources.id }).from(sources).where(eq(sources.url, url)).limit(1);
      if (existing?.id) return json({ error: "Source already exists", existingId: existing.id }, { status: 409 });
      return json({ error: "Source already exists" }, { status: 409 });
    }
    return json({ error: anyErr instanceof Error ? anyErr.message : "Failed to create source" }, { status: 400 });
  }
}
