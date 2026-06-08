export const runtime = "edge";

import { getDb, iocs, normalizeIoc } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

const IOC_KINDS = new Set(["ipv4", "ipv6", "domain", "url", "md5", "sha1", "sha256"]);

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "IOC management is available on Pro." }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kindRaw = (url.searchParams.get("kind") ?? "").trim().toLowerCase();
  const kind = IOC_KINDS.has(kindRaw) ? kindRaw : "";
  const limit = clampInt(url.searchParams.get("limit"), 200, 1, 500);

  const where = [eq(iocs.projectId, ctx.project.id)];
  if (kind) where.push(eq(iocs.kind, kind as any));
  if (q) where.push(sql`(${iocs.value} ilike ${`%${q}%`} or ${iocs.normalized} ilike ${`%${q}%`})`);

  try {
    const rows = await db
      .select({
        id: iocs.id,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
        tags: iocs.tags,
        firstSeenAt: iocs.firstSeenAt,
        lastSeenAt: iocs.lastSeenAt,
        createdAt: iocs.createdAt,
        updatedAt: iocs.updatedAt,
      })
      .from(iocs)
      .where(and(...where))
      .orderBy(desc(iocs.lastSeenAt), desc(iocs.createdAt))
      .limit(limit);

    return json({ ok: true, items: rows });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "IOC management is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const itemsRaw: string[] = Array.isArray(body?.items)
    ? body.items.map((v: any) => String(v ?? ""))
    : typeof body?.text === "string"
      ? body.text.split(/[\r\n,]+/g).map((s: string) => s.trim())
      : typeof body?.value === "string"
        ? [body.value]
        : [];

  const items = itemsRaw.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 2000);
  if (!items.length) return json({ error: "No IOC values provided" }, { status: 400 });

  const tagsInput = Array.isArray(body?.tags) ? body.tags : [];
  const tags = tagsInput
    .map((t: any) => String(t ?? "").trim())
    .filter((t: string) => t.length > 0 && t.length <= 64)
    .slice(0, 50);

  const parsed = items.map((v) => ({ raw: v, res: normalizeIoc(v) }));
  const good = parsed.filter((p) => p.res.ok).map((p) => (p.res as any).ioc) as Array<{
    kind: string;
    value: string;
    normalized: string;
  }>;
  const bad = parsed.filter((p) => !p.res.ok).map((p) => ({ value: p.raw, error: (p.res as any).error }));

  if (!good.length) return json({ error: "No valid IOCs found", errors: bad }, { status: 400 });

  const now = new Date();
  const values = good.map((ioc) => ({
    projectId: ctx.project.id,
    kind: ioc.kind as any,
    value: ioc.value,
    normalized: ioc.normalized,
    tags,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const rows = await db
      .insert(iocs)
      .values(values)
      .onConflictDoUpdate({
        target: [iocs.projectId, iocs.kind, iocs.normalized],
        set: {
          value: sql`excluded.value`,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning({
        id: iocs.id,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
        tags: iocs.tags,
        firstSeenAt: iocs.firstSeenAt,
        lastSeenAt: iocs.lastSeenAt,
        createdAt: iocs.createdAt,
        updatedAt: iocs.updatedAt,
      });

    return json({ ok: true, added: rows, errors: bad });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
