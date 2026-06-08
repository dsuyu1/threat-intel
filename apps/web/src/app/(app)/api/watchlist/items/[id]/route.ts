export const runtime = "edge";

import { getDb, watchlistItems } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const { id } = await ctx2.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  const body = (await req.json().catch(() => null)) as any;
  const enabled = body?.enabled == null ? null : Boolean(body.enabled);
  if (enabled == null) return json({ error: "enabled is required" }, { status: 400 });

  try {
    const [row] = await db
      .update(watchlistItems)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(watchlistItems.id, id), eq(watchlistItems.projectId, ctx.project.id), eq(watchlistItems.userId, ctx.user.id)))
      .returning({ id: watchlistItems.id, enabled: watchlistItems.enabled });

    if (!row) return json({ error: "Not found" }, { status: 404 });
    return json({ ok: true, item: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Watchlist tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to update item" }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const { id } = await ctx2.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  try {
    const res = await db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.id, id), eq(watchlistItems.projectId, ctx.project.id), eq(watchlistItems.userId, ctx.user.id)))
      .returning({ id: watchlistItems.id });

    if (!res.length) return json({ error: "Not found" }, { status: 404 });
    return json({ ok: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Watchlist tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to delete item" }, { status: 400 });
  }
}

