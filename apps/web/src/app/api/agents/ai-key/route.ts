export const runtime = "edge";

import { and, eq } from "drizzle-orm";
import { getDb, userAiKeys } from "@ti/db";
import { getViewerContext } from "../../../../lib/tenancy";
import { decryptSecret, encryptSecret } from "../../../../lib/secretbox";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function normalizeProvider(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "gemini") return "gemini";
  return "openai";
}

export async function GET() {
  const db = getDb();
  const ctx = await getViewerContext();

  try {
    const [row] = await db
      .select({
        id: userAiKeys.id,
        provider: userAiKeys.provider,
        baseUrl: userAiKeys.baseUrl,
        updatedAt: userAiKeys.updatedAt,
      })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, ctx.user.id), eq(userAiKeys.projectId, ctx.project.id)))
      .limit(1);

    return json({
      ok: true,
      configured: !!row,
      provider: row ? String(row.provider) : null,
      baseUrl: row?.baseUrl ? String(row.baseUrl) : null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "AI key tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: "Failed to load key status" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();
  const body = (await req.json().catch(() => null)) as any;

  const provider = normalizeProvider(body?.provider);
  const apiKey = String(body?.apiKey ?? "").trim();
  const baseUrlRaw = body?.baseUrl != null ? String(body.baseUrl).trim() : "";
  const baseUrl = baseUrlRaw || null;

  if (!apiKey) return json({ error: "apiKey is required" }, { status: 400 });
  if (apiKey.length < 20) return json({ error: "apiKey looks too short" }, { status: 400 });
  if (baseUrl && baseUrl.length > 500) return json({ error: "baseUrl is too long" }, { status: 400 });

  try {
    // Sanity: ensure encryption is configured; never store plaintext.
    const apiKeyEnc = await encryptSecret(apiKey);

    // Validate decrypt roundtrip (catches misconfigured runtimes/crypto).
    const roundtrip = await decryptSecret(apiKeyEnc);
    if (roundtrip !== apiKey) throw new Error("Encryption roundtrip failed");

    await db
      .insert(userAiKeys)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        provider,
        apiKeyEnc,
        baseUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userAiKeys.projectId, userAiKeys.userId, userAiKeys.provider],
        set: { apiKeyEnc, baseUrl, updatedAt: new Date() },
      });

    return json({ ok: true, configured: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "AI key tables are missing. Run pnpm db:migrate." }, { status: 503 });
    const msg = String((err as any)?.message ?? err ?? "");
    if (/TI_SECRETS_KEY is not set/i.test(msg)) return json({ error: msg }, { status: 500 });
    return json({ error: "Failed to save key" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider"));

  try {
    await db
      .delete(userAiKeys)
      .where(
        and(
          eq(userAiKeys.userId, ctx.user.id),
          eq(userAiKeys.projectId, ctx.project.id),
          eq(userAiKeys.provider, provider)
        )
      );
    return json({ ok: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "AI key tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: "Failed to delete key" }, { status: 500 });
  }
}

