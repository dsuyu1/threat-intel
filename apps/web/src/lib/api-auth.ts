import "server-only";

import { apiKeyRateLimits, apiKeys, getDb } from "@ti/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ApiScope } from "./api-keys";
import { parseScopesJson, sha256Hex } from "./api-keys";

type ApiKeyRecord = {
  id: string;
  projectId: string;
  userId: string;
  scopesJson: string;
  rateLimitPerMin: number;
  revokedAt: Date | null;
};

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function extractApiKey(req: Request) {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const x = req.headers.get("x-api-key");
  if (x) return x.trim();
  return null;
}

function hasScope(scopesJson: string, required: ApiScope) {
  const scopes = parseScopesJson(scopesJson);
  if (scopes.includes("*")) return true;
  return scopes.includes(required);
}

async function enforceRateLimit(params: { apiKeyId: string; limitPerMin: number }) {
  const limit = Math.max(0, Math.floor(params.limitPerMin));
  if (!limit) return { ok: true as const };

  const now = Date.now();
  const windowStartMs = Math.floor(now / 60_000) * 60_000;
  const windowStart = new Date(windowStartMs);

  const db = getDb();
  const [row] = await db
    .insert(apiKeyRateLimits)
    .values({ apiKeyId: params.apiKeyId, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [apiKeyRateLimits.apiKeyId, apiKeyRateLimits.windowStart],
      set: { count: sql`${apiKeyRateLimits.count} + 1` },
    })
    .returning({ count: apiKeyRateLimits.count });

  const count = Number(row?.count ?? 0);
  if (count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + 60_000 - now) / 1000));
    return { ok: false as const, retryAfterSeconds };
  }

  return { ok: true as const };
}

export async function requireApiKey(req: Request, params: { scope: ApiScope }) {
  const raw = extractApiKey(req);
  if (!raw) return { ok: false as const, res: json({ error: "Missing API key" }, { status: 401 }) };

  const hash = await sha256Hex(raw);
  const db = getDb();

  const [row] = await db
    .select({
      id: apiKeys.id,
      projectId: apiKeys.projectId,
      userId: apiKeys.userId,
      scopesJson: apiKeys.scopes,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const key = (row ?? null) as ApiKeyRecord | null;
  if (!key) return { ok: false as const, res: json({ error: "Invalid API key" }, { status: 401 }) };
  if (!hasScope(key.scopesJson, params.scope)) {
    return { ok: false as const, res: json({ error: "Forbidden" }, { status: 403 }) };
  }

  const rl = await enforceRateLimit({ apiKeyId: key.id, limitPerMin: Number(key.rateLimitPerMin ?? 0) });
  if (!rl.ok) {
    return {
      ok: false as const,
      res: new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(rl.retryAfterSeconds),
        },
      }),
    };
  }

  // Best-effort usage tracking.
  try {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  } catch {
    // ignore
  }

  return { ok: true as const, apiKey: key };
}

