export const runtime = "edge";

import { getDb, agentSettings } from "@ti/db";
import { eq } from "drizzle-orm";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function PATCH(req: Request) {
  const db = getDb();
  const body = (await req.json().catch(() => null)) as any;

  const agentKey = String(body?.agentKey ?? "").trim();
  const enabled = Boolean(body?.enabled);
  if (!agentKey) return json({ error: "agentKey is required" }, { status: 400 });

  try {
    await db
      .insert(agentSettings)
      .values({ agentKey, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: agentSettings.agentKey,
        set: { enabled, updatedAt: new Date() },
      });

    const [row] = await db
      .select({ agentKey: agentSettings.agentKey, enabled: agentSettings.enabled })
      .from(agentSettings)
      .where(eq(agentSettings.agentKey, agentKey))
      .limit(1);

    return json({ ok: true, setting: row ?? { agentKey, enabled } });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    return json({ error: "Failed to update agent setting" }, { status: 500 });
  }
}
