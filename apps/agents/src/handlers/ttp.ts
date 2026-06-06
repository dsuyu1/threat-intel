import type { ScheduledEvent, Context } from "aws-lambda";
import { getDb, kgEntities, kgRelations } from "@ti/db";
import { gte, sql } from "drizzle-orm";
import { runTtpAgent } from "../agents/ttp.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  const agentKey = "ttp";
  console.log("[Lambda] TTPAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runTtpAgent();

    const db = getDb();
    const entitiesRows = await db
      .select({ entitiesTouched: sql<number>`count(*)` })
      .from(kgEntities)
      .where(gte(kgEntities.updatedAt, run.startedAt));
    const entitiesTouched = entitiesRows[0]?.entitiesTouched ?? 0;

    const relationsRows = await db
      .select({ relationsTouched: sql<number>`count(*)` })
      .from(kgRelations)
      .where(gte(kgRelations.lastSeen, run.startedAt));
    const relationsTouched = relationsRows[0]?.relationsTouched ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { entitiesTouched: Number(entitiesTouched ?? 0), relationsTouched: Number(relationsTouched ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
