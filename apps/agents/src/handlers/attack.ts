import type { ScheduledEvent, Context } from "aws-lambda";
import { runAttackAgent } from "../agents/attack.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  console.log("[Lambda] AttackAgent triggered by EventBridge");
  await runAttackAgent();
};
