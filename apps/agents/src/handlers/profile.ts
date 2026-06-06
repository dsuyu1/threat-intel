import type { ScheduledEvent, Context } from "aws-lambda";
import { getDb, actorNeighbors, actorProfiles } from "@ti/db";
import { gte, sql } from "drizzle-orm";
import { runActorProfileAgent } from "../agents/profile.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  const agentKey = "actor-profile";
  console.log("[Lambda] ActorProfileAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runActorProfileAgent();

    const db = getDb();
    const profilesRows = await db
      .select({ profilesTouched: sql<number>`count(*)` })
      .from(actorProfiles)
      .where(gte(actorProfiles.updatedAt, run.startedAt));
    const profilesTouched = profilesRows[0]?.profilesTouched ?? 0;

    const neighborsRows = await db
      .select({ neighborsComputed: sql<number>`count(*)` })
      .from(actorNeighbors)
      .where(gte(actorNeighbors.computedAt, run.startedAt));
    const neighborsComputed = neighborsRows[0]?.neighborsComputed ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { profilesTouched: Number(profilesTouched ?? 0), neighborsComputed: Number(neighborsComputed ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
