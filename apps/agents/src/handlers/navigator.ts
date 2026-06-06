import type { ScheduledEvent, Context } from "aws-lambda";
import { getDb, navigatorScenarios } from "@ti/db";
import { gte, sql } from "drizzle-orm";
import { runNavigatorAgent } from "../agents/navigator.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  const agentKey = "navigator";
  console.log("[Lambda] NavigatorAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runNavigatorAgent();

    const db = getDb();
    const rows = await db
      .select({ scenariosComputed: sql<number>`count(*)` })
      .from(navigatorScenarios)
      .where(gte(navigatorScenarios.computedAt, run.startedAt));
    const scenariosComputed = rows[0]?.scenariosComputed ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { scenariosComputed: Number(scenariosComputed ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
