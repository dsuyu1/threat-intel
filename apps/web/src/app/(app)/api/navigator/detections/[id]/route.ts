export const runtime = "edge";

import type { NextRequest } from "next/server";
import { getDb, navigatorDetections } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

type LifecycleStatus = "draft" | "peer_reviewed" | "deployed" | "monitoring" | "retired";
const STATUSES: LifecycleStatus[] = ["draft", "peer_reviewed", "deployed", "monitoring", "retired"];

function normalizeStatus(input: unknown): LifecycleStatus | null {
  const v = String(input ?? "").trim().toLowerCase();
  return (STATUSES as readonly string[]).includes(v) ? (v as LifecycleStatus) : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const { id } = await ctx.params;
  const detectionId = String(id ?? "").trim();
  if (!detectionId) return json({ error: "id is required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;
  const lifecycleStatus = normalizeStatus(body?.lifecycleStatus);
  if (!lifecycleStatus) {
    return json({ error: `lifecycleStatus must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }

  let existing:
    | {
        id: string;
        lifecycleStatus: string;
        reviewedAt: Date | null;
        reviewedBy: string | null;
        deployedAt: Date | null;
        retiredAt: Date | null;
      }
    | undefined;

  try {
    [existing] = await db
      .select({
        id: navigatorDetections.id,
        lifecycleStatus: navigatorDetections.lifecycleStatus,
        reviewedAt: navigatorDetections.reviewedAt,
        reviewedBy: navigatorDetections.reviewedBy,
        deployedAt: navigatorDetections.deployedAt,
        retiredAt: navigatorDetections.retiredAt,
      })
      .from(navigatorDetections)
      .where(and(eq(navigatorDetections.id, detectionId), eq(navigatorDetections.projectId, viewer.project.id)))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") {
      return json({ error: "Detections tables are missing or out of date. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }

  if (!existing) return json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const set: Record<string, any> = { lifecycleStatus, updatedAt: now };

  if (lifecycleStatus === "draft") {
    set.reviewedAt = null;
    set.reviewedBy = null;
    set.deployedAt = null;
    set.retiredAt = null;
  } else if (lifecycleStatus === "peer_reviewed") {
    set.reviewedAt = now;
    set.reviewedBy = viewer.user.id;
    set.deployedAt = null;
    set.retiredAt = null;
  } else if (lifecycleStatus === "deployed") {
    set.deployedAt = now;
    set.retiredAt = null;
  } else if (lifecycleStatus === "monitoring") {
    if (!existing.deployedAt) set.deployedAt = now;
    set.retiredAt = null;
  } else if (lifecycleStatus === "retired") {
    set.retiredAt = now;
  }

  let updated:
    | {
        id: string;
        lifecycleStatus: string;
        reviewedAt: Date | null;
        reviewedBy: string | null;
        deployedAt: Date | null;
        retiredAt: Date | null;
        updatedAt: Date;
      }
    | undefined;

  try {
    [updated] = await db
      .update(navigatorDetections)
      .set(set)
      .where(and(eq(navigatorDetections.id, detectionId), eq(navigatorDetections.projectId, viewer.project.id)))
      .returning({
        id: navigatorDetections.id,
        lifecycleStatus: navigatorDetections.lifecycleStatus,
        reviewedAt: navigatorDetections.reviewedAt,
        reviewedBy: navigatorDetections.reviewedBy,
        deployedAt: navigatorDetections.deployedAt,
        retiredAt: navigatorDetections.retiredAt,
        updatedAt: navigatorDetections.updatedAt,
      });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") {
      return json({ error: "Detections tables are missing or out of date. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }

  return json({ ok: true, detection: updated ?? null });
}
