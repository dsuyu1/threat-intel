export const runtime = "edge";

import { getDb, riskEntries } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const STATUS = new Set(["open", "accepted", "mitigating", "closed"]);
const CATEGORY = new Set(["operational", "financial", "compliance", "reputational"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ scenarioId: string }> }) {
  const { scenarioId } = await ctx.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Risk register is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;

  const statusRaw = body?.status != null ? String(body.status).trim() : null;
  const categoryRaw = body?.category != null ? String(body.category).trim() : null;
  const ownerRaw = body?.owner != null ? String(body.owner) : null;
  const notesRaw = body?.notes != null ? String(body.notes) : null;
  const fairLefRaw = body?.fairLef != null ? String(body.fairLef) : null;
  const fairLmLowRaw = body?.fairLmLow != null ? String(body.fairLmLow) : null;
  const fairLmHighRaw = body?.fairLmHigh != null ? String(body.fairLmHigh) : null;

  if (statusRaw != null && !STATUS.has(statusRaw)) {
    return json({ error: "status must be one of: open, accepted, mitigating, closed" }, { status: 400 });
  }
  if (categoryRaw != null && !CATEGORY.has(categoryRaw)) {
    return json({ error: "category must be one of: operational, financial, compliance, reputational" }, { status: 400 });
  }

  const now = new Date();

  try {
    await db
      .insert(riskEntries)
      .values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        scenarioId,
        status: "open" as any,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Risk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  let existing:
    | { id: string; status: string; acceptedAt: Date | null; closedAt: Date | null }
    | undefined;

  try {
    [existing] = await db
      .select({
        id: riskEntries.id,
        status: riskEntries.status,
        acceptedAt: riskEntries.acceptedAt,
        closedAt: riskEntries.closedAt,
      })
      .from(riskEntries)
      .where(and(eq(riskEntries.projectId, viewer.project.id), eq(riskEntries.scenarioId, scenarioId)))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Risk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!existing) return json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, any> = { updatedAt: now };

  if (statusRaw != null) {
    patch.status = statusRaw;
    if (statusRaw === "accepted" && !existing.acceptedAt) patch.acceptedAt = now;
    if (statusRaw === "closed") {
      if (!existing.closedAt) patch.closedAt = now;
    } else {
      // Reopening clears closed_at so the entry is treated as active again.
      patch.closedAt = null;
    }
  }

  if (categoryRaw != null) patch.category = categoryRaw;

  if (ownerRaw != null) {
    const owner = ownerRaw.trim();
    patch.owner = owner ? owner.slice(0, 120) : null;
  }

  if (notesRaw != null) {
    const notes = notesRaw.trim();
    patch.notes = notes ? notes.slice(0, 20_000) : null;
  }

  const parseOptionalNumber = (raw: string | null, min: number, max: number) => {
    if (raw == null) return { has: false, value: null as number | null };
    const s = raw.trim();
    if (!s) return { has: true, value: null as number | null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { has: true, error: "must be a number" as const, value: null as number | null };
    return { has: true, value: Math.max(min, Math.min(max, n)) };
  };

  const parseOptionalInt = (raw: string | null, min: number, max: number) => {
    const p = parseOptionalNumber(raw, min, max);
    if ("error" in p) return p;
    if (!p.has) return p;
    return { has: true, value: p.value == null ? null : Math.round(p.value) };
  };

  const lef = parseOptionalNumber(fairLefRaw, 0, 50);
  if ("error" in lef) return json({ error: `fairLef ${lef.error}` }, { status: 400 });
  if (lef.has) patch.fairLef = lef.value;

  const lmLow = parseOptionalInt(fairLmLowRaw, 0, 2_000_000_000);
  if ("error" in lmLow) return json({ error: `fairLmLow ${lmLow.error}` }, { status: 400 });
  if (lmLow.has) patch.fairLmLow = lmLow.value;

  const lmHigh = parseOptionalInt(fairLmHighRaw, 0, 2_000_000_000);
  if ("error" in lmHigh) return json({ error: `fairLmHigh ${lmHigh.error}` }, { status: 400 });
  if (lmHigh.has) patch.fairLmHigh = lmHigh.value;

  if (lmLow.has && lmHigh.has && lmLow.value != null && lmHigh.value != null && lmHigh.value < lmLow.value) {
    return json({ error: "fairLmHigh must be >= fairLmLow" }, { status: 400 });
  }

  let row:
    | {
        id: string;
        scenarioId: string;
        status: string;
        category: string;
        owner: string | null;
        notes: string | null;
        fairLef: number | null;
        fairLmLow: number | null;
        fairLmHigh: number | null;
        acceptedAt: Date | null;
        closedAt: Date | null;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(riskEntries)
      .set(patch)
      .where(and(eq(riskEntries.projectId, viewer.project.id), eq(riskEntries.scenarioId, scenarioId)))
      .returning({
        id: riskEntries.id,
        scenarioId: riskEntries.scenarioId,
        status: riskEntries.status,
        category: riskEntries.category,
        owner: riskEntries.owner,
        notes: riskEntries.notes,
        fairLef: riskEntries.fairLef,
        fairLmLow: riskEntries.fairLmLow,
        fairLmHigh: riskEntries.fairLmHigh,
        acceptedAt: riskEntries.acceptedAt,
        closedAt: riskEntries.closedAt,
        updatedAt: riskEntries.updatedAt,
        createdAt: riskEntries.createdAt,
      });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Risk tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, entry: row });
}
