import type { Context, ScheduledEvent } from "aws-lambda";
import { getDb, navigatorDetectionJobs } from "@ti/db";
import { gte, sql } from "drizzle-orm";
import { runDetectionsAgent } from "../agents/detections.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  const agentKey = "detections";
  console.log("[Lambda] DetectionsAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runDetectionsAgent();

    const db = getDb();
    const rows = await db
      .select({ jobsTouched: sql<number>`count(*)` })
      .from(navigatorDetectionJobs)
      .where(gte(navigatorDetectionJobs.updatedAt, run.startedAt));
    const jobsTouched = rows[0]?.jobsTouched ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { jobsTouched: Number(jobsTouched ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};

