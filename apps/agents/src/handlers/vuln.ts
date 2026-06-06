import type { ScheduledEvent, Context } from "aws-lambda";
import { getDb, findings } from "@ti/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { runVulnAgent } from "../agents/vuln.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  const agentKey = "vuln";
  console.log("[Lambda] VulnAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runVulnAgent();

    const db = getDb();
    const rows = await db
      .select({ countFindings: sql<number>`count(*)` })
      .from(findings)
      .where(and(eq(findings.agent, "vuln"), gte(findings.createdAt, run.startedAt)));
    const countFindings = rows[0]?.countFindings ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { findingsInserted: Number(countFindings ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
