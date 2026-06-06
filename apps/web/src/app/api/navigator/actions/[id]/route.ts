export const runtime = "edge";

import type { NextRequest } from "next/server";
import { getDb, navigatorActions } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

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
  const dueDate = body?.dueDate != null ? new Date(String(body.dueDate)) : null;

  const set: Record<string, any> = { updatedAt: new Date() };
  if (title) set.title = title;
  if (status) set.status = status;
  if (body?.dueDate === null) set.dueDate = null;
  if (dueDate && Number.isFinite(dueDate.getTime())) set.dueDate = dueDate;

  await db
    .update(navigatorActions)
    .set(set)
    .where(and(eq(navigatorActions.id, id), eq(navigatorActions.projectId, viewer.project.id)));

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
