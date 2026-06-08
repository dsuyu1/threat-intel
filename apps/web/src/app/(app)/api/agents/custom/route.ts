export const runtime = "edge";

import { customAgents, getDb, userAiKeys } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const DEFAULT_DEFINITION = {
  version: 1,
  steps: [
    { type: "fetch_findings", params: { hoursBack: 24, agents: ["vuln", "attack"], limit: 20 } },
    {
      type: "generate_report",
      params: {
        prompt:
          "Create a short daily intel brief tailored to my stack. Call out what changed, what to validate, and what to remediate first.",
        maxTokens: 800,
        temperature: 0.2,
      },
    },
  ],
};

export async function POST(req: Request) {
  const db = getDb();
  const ctx = await getViewerContext();

  // Custom agents can call LLMs via the agents service:
  // - Pro users can run them using the platform key
  // - Free users can run them if they configure their own API key (BYOK)
  const proAccess = hasNavigatorAccess({ tier: ctx.user.tier });
  let hasKey = false;
  try {
    const [row] = await db
      .select({ id: userAiKeys.id })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, ctx.user.id), eq(userAiKeys.projectId, ctx.project.id)))
      .limit(1);
    hasKey = !!row;
  } catch {
    hasKey = false;
  }
  if (!proAccess && !hasKey) {
    return json({ error: "Custom agents require Pro or your own API key (Agents → Your API key)." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as any;
  const name = String(body?.name ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const enabled = body?.enabled === false ? false : true;
  const scheduleMinutes = Number(body?.scheduleMinutes ?? 1440);
  const definition = body?.definition ?? DEFAULT_DEFINITION;

  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (name.length > 80) return json({ error: "name is too long" }, { status: 400 });

  const safeSchedule = Number.isFinite(scheduleMinutes) ? Math.max(5, Math.min(10080, Math.round(scheduleMinutes))) : 1440;

  try {
    const [row] = await db
      .insert(customAgents)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        name,
        description: description || null,
        enabled,
        scheduleMinutes: safeSchedule,
        definition,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: customAgents.id });

    return json({ ok: true, id: row?.id ?? null });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    const msg = String((err as any)?.message ?? err ?? "");
    if (/custom_agents_user_name_idx|unique/i.test(msg)) {
      return json({ error: "You already have an agent with this name." }, { status: 409 });
    }
    return json({ error: "Failed to create agent" }, { status: 500 });
  }
}
