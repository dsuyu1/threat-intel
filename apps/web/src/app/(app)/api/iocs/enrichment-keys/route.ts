export const runtime = "edge";

import { getDb, iocEnrichmentKeys } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../../../../../lib/secretbox";
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

function normalizeProvider(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "virustotal" || s === "shodan") return s as "virustotal" | "shodan";
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
    const keys = await db
      .select({
        id: iocEnrichmentKeys.id,
        provider: iocEnrichmentKeys.provider,
        enabled: iocEnrichmentKeys.enabled,
        createdAt: iocEnrichmentKeys.createdAt,
        updatedAt: iocEnrichmentKeys.updatedAt,
      })
      .from(iocEnrichmentKeys)
      .where(eq(iocEnrichmentKeys.projectId, ctx.project.id))
      .orderBy(asc(iocEnrichmentKeys.provider))
      .limit(50);
    return json({ ok: true, keys });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function PUT(req: Request) {
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
  const provider = normalizeProvider(body?.provider);
  if (!provider) return json({ error: "provider must be virustotal or shodan" }, { status: 400 });

  const enabled = body?.enabled !== false;
  const apiKey = String(body?.apiKey ?? "").trim();
  const now = new Date();

  try {
    if (!apiKey) {
      const [existing] = await db
        .select({ id: iocEnrichmentKeys.id })
        .from(iocEnrichmentKeys)
        .where(and(eq(iocEnrichmentKeys.projectId, ctx.project.id), eq(iocEnrichmentKeys.provider, provider)))
        .limit(1);
      if (!existing) return json({ error: "apiKey is required to create a new key" }, { status: 400 });
      await db
        .update(iocEnrichmentKeys)
        .set({ enabled, updatedAt: now, userId: ctx.user.id })
        .where(eq(iocEnrichmentKeys.id, existing.id));
      return json({ ok: true });
    }

    const apiKeyEnc = await encryptSecret(apiKey);

    await db
      .insert(iocEnrichmentKeys)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        provider,
        enabled,
        apiKeyEnc,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [iocEnrichmentKeys.projectId, iocEnrichmentKeys.provider],
        set: { enabled, apiKeyEnc, updatedAt: now, userId: ctx.user.id },
      });

    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

// Lightweight sanity check: decrypts the payload to ensure TI_SECRETS_KEY is configured correctly.
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
  const provider = normalizeProvider(body?.provider);
  if (!provider) return json({ error: "provider must be virustotal or shodan" }, { status: 400 });

  try {
    const [row] = await db
      .select({ apiKeyEnc: iocEnrichmentKeys.apiKeyEnc, enabled: iocEnrichmentKeys.enabled })
      .from(iocEnrichmentKeys)
      .where(and(eq(iocEnrichmentKeys.projectId, ctx.project.id), eq(iocEnrichmentKeys.provider, provider)))
      .limit(1);
    if (!row?.enabled) return json({ ok: false, error: "Key is missing or disabled" }, { status: 400 });
    const apiKey = await decryptSecret(row.apiKeyEnc);
    return json({ ok: true, provider, keyLength: apiKey.length });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ ok: false, error: "Failed to validate key decryption" }, { status: 500 });
  }
}
