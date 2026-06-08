import { dispatchJiraAutomationForFindingId } from "./jira-automation.js";
import { upsertProjectFindingStackMatchesForFindingId } from "./stack-correlation.js";
import { dispatchWatchlistNotificationsForFindingId } from "./watchlist.js";

export async function runPostFindingHooks(db: any, findingId: string) {
  const jobs = await Promise.allSettled([
    dispatchJiraAutomationForFindingId(db, findingId),
    dispatchWatchlistNotificationsForFindingId(db, findingId),
    upsertProjectFindingStackMatchesForFindingId(db, findingId),
  ]);

  for (const j of jobs) {
    if (j.status === "rejected") {
      console.warn("[PostFindingHooks] Hook failed:", j.reason);
    }
  }
}

