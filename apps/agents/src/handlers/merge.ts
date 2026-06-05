import type { ScheduledEvent, Context } from "aws-lambda";
import { runMergeAgent } from "../agents/merge.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  console.log("[Lambda] MergeAgent triggered");
  await runMergeAgent();
};

