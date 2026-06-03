import type { ScheduledEvent, Context } from "aws-lambda";
import { runVulnAgent } from "../agents/vuln.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  console.log("[Lambda] VulnAgent triggered by EventBridge");
  await runVulnAgent();
};
