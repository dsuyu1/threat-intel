import type { ScheduledEvent, Context } from "aws-lambda";
import { runTtpAgent } from "../agents/ttp.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  console.log("[Lambda] TTPAgent triggered by EventBridge");
  await runTtpAgent();
};
