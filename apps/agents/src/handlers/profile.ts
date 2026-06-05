import type { ScheduledEvent, Context } from "aws-lambda";
import { runActorProfileAgent } from "../agents/profile.js";

export const handler = async (
  _event: ScheduledEvent,
  _ctx: Context
): Promise<void> => {
  console.log("[Lambda] ActorProfileAgent triggered by EventBridge");
  await runActorProfileAgent();
};

