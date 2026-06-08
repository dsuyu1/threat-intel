import type { ScheduledEvent, Context } from "aws-lambda";
import { getDb, findings } from "@ti/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { runEpssEnrichAgent } from "../agents/epss-enrich.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (_event: ScheduledEvent, _ctx: Context): Promise<void> => {
  const agentKey = "epss-enrich";
  console.log("[Lambda] EpssEnrichAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    await runEpssEnrichAgent();

    // Approximate metric: number of CVE findings updated since run start that now have EPSS score.
    const db = getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(findings)
      .where(and(isNotNull(findings.cveId), isNotNull(findings.epssScore), gte(findings.epssUpdatedAt, run.startedAt)));

    const count = rows[0]?.count ?? 0;

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { findingsEnriched: Number(count ?? 0) },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
