/**
 * NavigatorAgent — recomputes CTEM scenarios for Pro users.
 *
 * Run: pnpm run:navigator
 * Cron: daily
 */

import "../lib/env.js";
import { getDb, recomputeNavigatorScenariosForAllProUsers } from "@ti/db";

export async function runNavigatorAgent() {
  console.log("[NavigatorAgent] Starting...");
  const db = getDb();
  const includeInferred = (process.env["NAVIGATOR_AGENT_INCLUDE_INFERRED"] ?? "1") !== "0";
  const res = await recomputeNavigatorScenariosForAllProUsers({ db, includeInferred });
  console.log(`[NavigatorAgent] Done. Users: ${res.users} | Scenarios: ${res.scenarios}`);
}

if (process.argv[1]?.endsWith("navigator.ts")) {
  runNavigatorAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

