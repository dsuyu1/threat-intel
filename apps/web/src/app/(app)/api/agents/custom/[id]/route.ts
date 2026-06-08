export const runtime = "edge";

import { customAgents, getDb, userAiKeys } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const viewer = await getViewerContext();

  const proAccess = hasNavigatorAccess({ tier: viewer.user.tier });
  let hasKey = false;
  try {
    const [row] = await db
      .select({ id: userAiKeys.id })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, viewer.user.id), eq(userAiKeys.projectId, viewer.project.id)))
      .limit(1);
    hasKey = !!row;
  } catch {
    hasKey = false;
  }
  if (!proAccess && !hasKey) {
    return json({ error: "Custom agents require Pro or your own API key (Agents → Your API key)." }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as any;

  // Ensure ownership (without leaking user IDs).
  let owner: { userId: string; projectId: string } | undefined;
  try {
    [owner] = await db
      .select({ userId: customAgents.userId, projectId: customAgents.projectId })
      .from(customAgents)
      .where(eq(customAgents.id, id))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    return json({ error: "Failed to load agent" }, { status: 500 });
  }
  if (!owner) return json({ error: "Agent not found" }, { status: 404 });
  if (owner.userId !== viewer.user.id) return json({ error: "Not authorized" }, { status: 403 });
  if (owner.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });

  const patch: Record<string, any> = { updatedAt: new Date() };

  if (body?.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name cannot be empty" }, { status: 400 });
    if (name.length > 80) return json({ error: "name is too long" }, { status: 400 });
    patch.name = name;
  }

  if (body?.description !== undefined) {
    const description = String(body.description ?? "").trim();
    patch.description = description || null;
  }

  if (body?.enabled !== undefined) patch.enabled = Boolean(body.enabled);

  if (body?.scheduleMinutes !== undefined) {
    const n = Number(body.scheduleMinutes);
    if (!Number.isFinite(n)) return json({ error: "scheduleMinutes must be a number" }, { status: 400 });
    patch.scheduleMinutes = Math.max(5, Math.min(10080, Math.round(n)));
  }

  if (body?.definition !== undefined) patch.definition = body.definition;

  try {
    await db.update(customAgents).set(patch).where(eq(customAgents.id, id));
    return json({ ok: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    const msg = String((err as any)?.message ?? err ?? "");
    if (/custom_agents_user_name_idx|unique/i.test(msg)) {
      return json({ error: "You already have an agent with this name." }, { status: 409 });
    }
    return json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const viewer = await getViewerContext();

  const proAccess = hasNavigatorAccess({ tier: viewer.user.tier });
  let hasKey = false;
  try {
    const [row] = await db
      .select({ id: userAiKeys.id })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, viewer.user.id), eq(userAiKeys.projectId, viewer.project.id)))
      .limit(1);
    hasKey = !!row;
  } catch {
    hasKey = false;
  }
  if (!proAccess && !hasKey) {
    return json({ error: "Custom agents require Pro or your own API key (Agents → Your API key)." }, { status: 403 });
  }

  const { id } = await ctx.params;

  let owner: { userId: string; projectId: string } | undefined;
  try {
    [owner] = await db
      .select({ userId: customAgents.userId, projectId: customAgents.projectId })
      .from(customAgents)
      .where(eq(customAgents.id, id))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    return json({ error: "Failed to load agent" }, { status: 500 });
  }
  if (!owner) return json({ error: "Agent not found" }, { status: 404 });
  if (owner.userId !== viewer.user.id) return json({ error: "Not authorized" }, { status: 403 });
  if (owner.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });

  try {
    await db.delete(customAgents).where(eq(customAgents.id, id));
    return json({ ok: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    return json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
