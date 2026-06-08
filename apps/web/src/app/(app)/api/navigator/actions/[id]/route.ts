export const runtime = "edge";

import type { NextRequest } from "next/server";
import { getDb, navigatorActions, navigatorActionSlaEvents } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as any;
  const title = body?.title != null ? String(body.title).trim() : null;
  const status = body?.status != null ? String(body.status).trim() : null;
  const slaTierIn = body?.slaTier != null ? String(body.slaTier).trim().toLowerCase() : null;
  const dueDate = body?.dueDate != null ? new Date(String(body.dueDate)) : null;

  const set: Record<string, any> = { updatedAt: new Date() };
  if (title) set.title = title;
  if (status) set.status = status;
  if (slaTierIn) {
    if (slaTierIn !== "critical" && slaTierIn !== "high" && slaTierIn !== "medium" && slaTierIn !== "low") {
      return json({ error: "slaTier must be one of: critical, high, medium, low" }, { status: 400 });
    }
    set.slaTier = slaTierIn;
  }
  if (body?.dueDate === null) set.dueDate = null;
  if (dueDate && Number.isFinite(dueDate.getTime())) set.dueDate = dueDate;

  await db
    .update(navigatorActions)
    .set(set)
    .where(and(eq(navigatorActions.id, id), eq(navigatorActions.projectId, viewer.project.id)));

  try {
    const [row] = await db
      .select({
        status: navigatorActions.status,
        dueDate: navigatorActions.dueDate,
      })
      .from(navigatorActions)
      .where(and(eq(navigatorActions.id, id), eq(navigatorActions.projectId, viewer.project.id)))
      .limit(1);

    const due = row?.dueDate ? new Date(row.dueDate as any) : null;
    if (due && Number.isFinite(due.getTime()) && due.getTime() < Date.now()) {
      const kind = String(row?.status) === "done" ? "resolved" : "breached";
      await db
        .insert(navigatorActionSlaEvents)
        .values({
          projectId: viewer.project.id,
          actionId: id,
          kind,
          dueDate: due,
          at: new Date(),
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01") throw err;
  }

  return json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const { id } = await ctx.params;
  await db
    .delete(navigatorActions)
    .where(and(eq(navigatorActions.id, id), eq(navigatorActions.projectId, viewer.project.id)));

  return json({ ok: true });
}
