export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, sources } from "@ti/db";
import { eq } from "drizzle-orm";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function clamp01(value: unknown) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getViewerContext(); // auth guard (sources are global)
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sourceId = String(id ?? "").trim();
  if (!sourceId) return json({ error: "Missing id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;

  const nameRaw = body?.name == null ? null : String(body.name).trim();
  const name = nameRaw ? nameRaw.slice(0, 200) : null;

  const reliability = clamp01(body?.reliability);

  const enabled = body?.enabled == null ? null : Boolean(body.enabled);

  if (name === "") return json({ error: "name cannot be empty" }, { status: 400 });
  if (body?.reliability != null && reliability == null) return json({ error: "reliability must be between 0 and 1" }, { status: 400 });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (name != null) update.name = name;
  if (reliability != null) update.reliability = reliability;
  if (enabled != null) update.enabled = enabled;

  if (Object.keys(update).length <= 1) return json({ error: "No fields to update" }, { status: 400 });

  const db = getDb();
  try {
    const [row] = await db.update(sources).set(update as any).where(eq(sources.id, sourceId)).returning({ id: sources.id });
    if (!row?.id) return json({ error: "Not found" }, { status: 404 });
    return json({ ok: true });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Sources tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to update source" }, { status: 400 });
  }
}

