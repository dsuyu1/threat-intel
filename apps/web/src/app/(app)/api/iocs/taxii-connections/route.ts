export const runtime = "edge";

import { getDb, iocTaxiiConnections } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { encryptSecret } from "../../../../../lib/secretbox";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

type AuthScheme = "none" | "bearer" | "basic";

function normalizeAuthScheme(v: unknown): AuthScheme | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "none" || s === "bearer" || s === "basic") return s as AuthScheme;
  return null;
}

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

  try {
    const connections = await db
      .select({
        id: iocTaxiiConnections.id,
        name: iocTaxiiConnections.name,
        enabled: iocTaxiiConnections.enabled,
        apiRootUrl: iocTaxiiConnections.apiRootUrl,
        collectionId: iocTaxiiConnections.collectionId,
        authScheme: iocTaxiiConnections.authScheme,
        username: iocTaxiiConnections.username,
        lookbackDays: iocTaxiiConnections.lookbackDays,
        lastSyncedAt: iocTaxiiConnections.lastSyncedAt,
        nextCursor: iocTaxiiConnections.nextCursor,
        createdAt: iocTaxiiConnections.createdAt,
        updatedAt: iocTaxiiConnections.updatedAt,
      })
      .from(iocTaxiiConnections)
      .where(eq(iocTaxiiConnections.projectId, ctx.project.id))
      .orderBy(asc(iocTaxiiConnections.name))
      .limit(200);
    return json({ ok: true, connections });
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
  const name = String(body?.name ?? "").trim();
  const apiRootUrl = String(body?.apiRootUrl ?? "").trim();
  const collectionId = String(body?.collectionId ?? "").trim();
  const authScheme = normalizeAuthScheme(body?.authScheme) ?? "none";

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!apiRootUrl) return json({ error: "apiRootUrl is required" }, { status: 400 });
  if (!collectionId) return json({ error: "collectionId is required" }, { status: 400 });

  const enabled = body?.enabled !== false;
  const lookbackDays = clampInt(body?.lookbackDays, 30, 1, 365);

  const apiKey = String(body?.apiKey ?? "").trim();
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "").trim();

  let apiKeyEnc: string | null = null;
  let passwordEnc: string | null = null;

  if (authScheme === "bearer") {
    if (!apiKey) return json({ error: "apiKey is required for bearer auth" }, { status: 400 });
    apiKeyEnc = await encryptSecret(apiKey);
  }

  if (authScheme === "basic") {
    if (!username) return json({ error: "username is required for basic auth" }, { status: 400 });
    if (!password) return json({ error: "password is required for basic auth" }, { status: 400 });
    passwordEnc = await encryptSecret(password);
  }

  const now = new Date();

  try {
    const [row] = await db
      .insert(iocTaxiiConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        enabled,
        apiRootUrl,
        collectionId,
        authScheme,
        apiKeyEnc,
        username: authScheme === "basic" ? username : null,
        passwordEnc,
        lookbackDays,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [iocTaxiiConnections.projectId, iocTaxiiConnections.name],
        set: {
          enabled,
          apiRootUrl,
          collectionId,
          authScheme,
          apiKeyEnc,
          username: authScheme === "basic" ? username : null,
          passwordEnc,
          lookbackDays,
          updatedAt: now,
          userId: ctx.user.id,
        },
      })
      .returning({
        id: iocTaxiiConnections.id,
        name: iocTaxiiConnections.name,
        enabled: iocTaxiiConnections.enabled,
        apiRootUrl: iocTaxiiConnections.apiRootUrl,
        collectionId: iocTaxiiConnections.collectionId,
        authScheme: iocTaxiiConnections.authScheme,
        username: iocTaxiiConnections.username,
        lookbackDays: iocTaxiiConnections.lookbackDays,
        lastSyncedAt: iocTaxiiConnections.lastSyncedAt,
        nextCursor: iocTaxiiConnections.nextCursor,
        createdAt: iocTaxiiConnections.createdAt,
        updatedAt: iocTaxiiConnections.updatedAt,
      });

    return json({ ok: true, connection: row ?? null });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function PATCH(req: Request) {
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
  const id = String(body?.id ?? "").trim();
  if (!id) return json({ error: "id is required" }, { status: 400 });

  const enabled = typeof body?.enabled === "boolean" ? body.enabled : undefined;
  const lookbackDays = body?.lookbackDays === undefined ? undefined : clampInt(body.lookbackDays, 30, 1, 365);

  if (enabled === undefined && lookbackDays === undefined) {
    return json({ error: "No fields to update" }, { status: 400 });
  }

  const now = new Date();

  try {
    const set: Record<string, unknown> = { updatedAt: now, userId: ctx.user.id };
    if (enabled !== undefined) set.enabled = enabled;
    if (lookbackDays !== undefined) set.lookbackDays = lookbackDays;

    const [row] = await db
      .update(iocTaxiiConnections)
      .set(set as any)
      .where(and(eq(iocTaxiiConnections.projectId, ctx.project.id), eq(iocTaxiiConnections.id, id)))
      .returning({
        id: iocTaxiiConnections.id,
        name: iocTaxiiConnections.name,
        enabled: iocTaxiiConnections.enabled,
        apiRootUrl: iocTaxiiConnections.apiRootUrl,
        collectionId: iocTaxiiConnections.collectionId,
        authScheme: iocTaxiiConnections.authScheme,
        username: iocTaxiiConnections.username,
        lookbackDays: iocTaxiiConnections.lookbackDays,
        lastSyncedAt: iocTaxiiConnections.lastSyncedAt,
        nextCursor: iocTaxiiConnections.nextCursor,
        createdAt: iocTaxiiConnections.createdAt,
        updatedAt: iocTaxiiConnections.updatedAt,
      });

    if (!row) return json({ error: "Connection not found" }, { status: 404 });
    return json({ ok: true, connection: row });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
