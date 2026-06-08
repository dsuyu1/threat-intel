export const runtime = "edge";
export const dynamic = "force-dynamic";

import { KqlError, runKql } from "@ti/db";
import { requireApiKey } from "../../../../../lib/api-auth";
import { getUserTierById } from "../../../../../lib/api-key-tier";
import { allowedTablesForTier } from "../../../../../lib/kql/allowedTables";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const MAX_QUERY_CHARS = 25_000;

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { scope: "query:run" });
  if (!auth.ok) return auth.res;
  if (!auth.apiKey.projectId) return json({ error: "Invalid API key" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as any;
  const query = String(body?.query ?? "");
  if (!query.trim()) return json({ error: "Missing query" }, { status: 400 });
  if (query.length > MAX_QUERY_CHARS) {
    return json({ error: `Query is too long (max ${MAX_QUERY_CHARS} characters)` }, { status: 400 });
  }

  const debug = body?.debug === true;
  const tier = await getUserTierById(auth.apiKey.userId);
  const allowedTables = allowedTablesForTier(tier);

  try {
    const res = await runKql(query, { defaultLimit: 200, maxLimit: 2000, debug, allowedTables, projectId: auth.apiKey.projectId });
    return json(res);
  } catch (err) {
    if (err instanceof KqlError) return json({ error: err.message, pos: err.pos }, { status: 400 });
    return json({ error: "Query failed" }, { status: 500 });
  }
}
