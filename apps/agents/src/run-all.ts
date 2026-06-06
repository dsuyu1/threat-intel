/**
 * run-all — convenience runner for local dev.
 *
 * Keeps parity with the scheduled Lambdas, but runs sequentially.
 */

import "./lib/env.js";
import { runVectorSmokeTest } from "./agents/vector-smoke.js";
import { runTtpAgent } from "./agents/ttp.js";
import { runOriginAgent } from "./agents/origin.js";
import { runAttackAgent } from "./agents/attack.js";
import { runVulnAgent } from "./agents/vuln.js";
import { runExploitAgent } from "./agents/exploit.js";
import { runMalwareAgent } from "./agents/malware.js";
import { runActorProfileAgent } from "./agents/profile.js";
import { runNavigatorAgent } from "./agents/navigator.js";
import { runCustomAgents } from "./agents/custom.js";

export async function runAllAgents() {
  await runVectorSmokeTest();
  await runTtpAgent();
  await runOriginAgent();
  await runAttackAgent();
  await runVulnAgent();
  await runExploitAgent();
  await runMalwareAgent();
  await runActorProfileAgent();
  await runNavigatorAgent();
  await runCustomAgents();
}

if (process.argv[1]?.endsWith("run-all.ts")) {
  runAllAgents().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
