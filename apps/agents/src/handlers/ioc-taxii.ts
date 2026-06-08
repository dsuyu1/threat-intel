import type { ScheduledEvent, Context } from "aws-lambda";
import { runIocTaxiiImportAgent } from "../agents/ioc-taxii.js";
import { finishRun, isAgentEnabled, logRunEvent, startRun } from "../lib/agent-runs.js";

export const handler = async (_event: ScheduledEvent, _ctx: Context): Promise<void> => {
  const agentKey = "ioc-taxii";
  console.log("[Lambda] IocTaxiiImportAgent triggered by EventBridge");

  const enabled = await isAgentEnabled(agentKey);
  const run = await startRun({ agentKey, kind: "system" });
  await logRunEvent({ runId: run.id, message: `Started (enabled=${enabled})` });

  if (!enabled) {
    await finishRun({ runId: run.id, status: "skipped", startedAt: run.startedAt });
    return;
  }

  try {
    const metrics = await runIocTaxiiImportAgent();
    await finishRun({ runId: run.id, status: "succeeded", startedAt: run.startedAt, metrics });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};

