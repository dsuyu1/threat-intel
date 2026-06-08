export const runtime = "edge";

import type { NextRequest } from "next/server";
import { getDb, navigatorDetectionJobs, navigatorScenarios, riskEntries } from "@ti/db";
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
  const validationStatus = body?.validationStatus != null ? String(body.validationStatus).trim() : null;
  if (!validationStatus) return json({ error: "validationStatus is required" }, { status: 400 });

  const allowed = new Set(["unvalidated", "in_progress", "validated", "not_applicable"]);
  if (!allowed.has(validationStatus)) {
    return json({ error: "validationStatus must be one of: unvalidated, in_progress, validated, not_applicable" }, { status: 400 });
  }

  const [scenario] = await db
    .select({
      validationStatus: navigatorScenarios.validationStatus,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, id), eq(navigatorScenarios.projectId, viewer.project.id)))
    .limit(1);

  if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });

  const wasValidated = scenario.validationStatus === "validated";

  await db
    .update(navigatorScenarios)
    .set({ validationStatus: validationStatus as any })
    .where(and(eq(navigatorScenarios.id, id), eq(navigatorScenarios.projectId, viewer.project.id)));

  let detectionsJobQueued = false;
  if (!wasValidated && validationStatus === "validated" && scenario.targetKind === "technique") {
    try {
      const now = new Date();
      await db.insert(navigatorDetectionJobs).values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        scenarioId: id,
        techniqueId: String(scenario.targetId),
        formats: ["sigma", "kql", "spl"],
        status: "queued",
        createdAt: now,
        updatedAt: now,
      });
      detectionsJobQueued = true;
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      // If detections tables aren't migrated yet, do not block validation workflows.
      if (code !== "42P01" && code !== "42703") throw err;
    }
  }

  let riskCreated = false;
  if (validationStatus === "validated") {
    try {
      const now = new Date();
      await db
        .insert(riskEntries)
        .values({
          projectId: viewer.project.id,
          userId: viewer.user.id,
          scenarioId: id,
          status: "open" as any,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [riskEntries.projectId, riskEntries.scenarioId],
          set: { updatedAt: now },
        });
      riskCreated = true;
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      // If risk tables aren't migrated yet, do not block validation workflows.
      if (code !== "42P01" && code !== "42703") throw err;
    }
  }

  return json({ ok: true, riskCreated, detectionsJobQueued });
}
