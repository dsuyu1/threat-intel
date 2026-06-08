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
import { runEpssEnrichAgent } from "./agents/epss-enrich.js";
import { runExploitAgent } from "./agents/exploit.js";
import { runMalwareAgent } from "./agents/malware.js";
import { runActorProfileAgent } from "./agents/profile.js";
import { runNavigatorAgent } from "./agents/navigator.js";
import { runCustomAgents } from "./agents/custom.js";
import { runTheHiveSyncAgent } from "./agents/thehive.js";
import { runIocTaxiiImportAgent } from "./agents/ioc-taxii.js";
import { runIocEnrichAgent } from "./agents/ioc-enrich.js";

export async function runAllAgents() {
  await runVectorSmokeTest();
  await runTtpAgent();
  await runOriginAgent();
  await runAttackAgent();
  await runVulnAgent();
  await runEpssEnrichAgent();
  await runExploitAgent();
  await runMalwareAgent();
  await runActorProfileAgent();
  await runNavigatorAgent();
  await runTheHiveSyncAgent();
  await runIocTaxiiImportAgent();
  await runIocEnrichAgent();
  await runCustomAgents();
}

if (process.argv[1]?.endsWith("run-all.ts")) {
  runAllAgents().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
