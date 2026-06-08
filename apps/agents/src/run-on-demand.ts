/**
 * run-on-demand — invoked by the web app to run agents immediately.
 *
 * NOTE: This is meant for local/self-hosted environments where a Node process
 * can execute long-running jobs. In managed serverless environments, prefer
 * scheduled handlers (AWS/CF cron).
 */

import "./lib/env.js";
import { getDb, agentSettings } from "@ti/db";
import { eq } from "drizzle-orm";
import { finishRun, logRunEvent, startRun } from "./lib/agent-runs.js";
import { runAttackAgent } from "./agents/attack.js";
import { runExploitAgent } from "./agents/exploit.js";
import { runMalwareAgent } from "./agents/malware.js";
import { runMergeAgent } from "./agents/merge.js";
import { runNavigatorAgent } from "./agents/navigator.js";
import { runOriginAgent } from "./agents/origin.js";
import { runActorProfileAgent } from "./agents/profile.js";
import { runTtpAgent } from "./agents/ttp.js";
import { runVulnAgent } from "./agents/vuln.js";
import { runVulnScannerSyncAgent } from "./agents/vuln-scanners.js";
import { runEpssEnrichAgent } from "./agents/epss-enrich.js";
import { runDetectionsAgent } from "./agents/detections.js";
import { runTheHiveSyncAgent } from "./agents/thehive.js";
import { runCustomAgents } from "./agents/custom.js";
import { runIocTaxiiImportAgent } from "./agents/ioc-taxii.js";
import { runIocEnrichAgent } from "./agents/ioc-enrich.js";

type SystemAgentKey =
  | "vuln"
  | "vuln-scanners"
  | "exploit"
  | "epss-enrich"
  | "attack"
  | "ttp"
  | "malware"
  | "thehive"
  | "actor-profile"
  | "navigator"
  | "detections"
  | "merge"
  | "ioc-taxii"
  | "ioc-enrich"
  | "custom-runner";

type Args = {
  agentKey: string;
  projectId: string | null;
  userId: string | null;
  customAgentId: string | null;
  scenarioId: string | null;
  connectionId: string | null;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    agentKey: "",
    projectId: null,
    userId: null,
    customAgentId: null,
    scenarioId: null,
    connectionId: null,
    force: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--agentKey") out.agentKey = String(argv[++i] ?? "");
    else if (a === "--projectId") out.projectId = String(argv[++i] ?? "");
    else if (a === "--userId") out.userId = String(argv[++i] ?? "");
    else if (a === "--customAgentId") out.customAgentId = String(argv[++i] ?? "");
    else if (a === "--scenarioId") out.scenarioId = String(argv[++i] ?? "");
    else if (a === "--connectionId") out.connectionId = String(argv[++i] ?? "");
    else if (a === "--force") out.force = String(argv[++i] ?? "1") !== "0";
  }

  out.agentKey = out.agentKey.trim();
  out.projectId = out.projectId ? out.projectId.trim() : null;
  out.userId = out.userId ? out.userId.trim() : null;
  out.customAgentId = out.customAgentId ? out.customAgentId.trim() : null;
  out.scenarioId = out.scenarioId ? out.scenarioId.trim() : null;
  out.connectionId = out.connectionId ? out.connectionId.trim() : null;

  return out;
}

async function isEnabledForSchedule(agentKey: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ enabled: agentSettings.enabled })
    .from(agentSettings)
    .where(eq(agentSettings.agentKey, agentKey))
    .limit(1);
  return row ? !!row.enabled : true;
}

function isSystemKey(k: string): k is SystemAgentKey {
  return (
    k === "vuln" ||
    k === "vuln-scanners" ||
    k === "exploit" ||
    k === "epss-enrich" ||
    k === "attack" ||
    k === "ttp" ||
    k === "malware" ||
    k === "thehive" ||
    k === "actor-profile" ||
    k === "navigator" ||
    k === "detections" ||
    k === "merge" ||
    k === "ioc-taxii" ||
    k === "ioc-enrich" ||
    k === "custom-runner"
  );
}

async function runSystemAgent(args: Args) {
  if (!args.projectId) throw new Error("--projectId is required for system agents");
  if (!isSystemKey(args.agentKey)) throw new Error(`Unsupported system agentKey: ${args.agentKey}`);

  const enabled = await isEnabledForSchedule(args.agentKey);
  const run = await startRun({
    agentKey: args.agentKey,
    kind: "system",
    projectId: args.projectId,
    userId: args.userId,
  });

  // Write a single JSON line so callers can discover the run quickly if they want to.
  console.log(JSON.stringify({ runId: run.id, agentKey: args.agentKey }));

  await logRunEvent({
    runId: run.id,
    message: `Manual run (enabled=${enabled}, forced=${args.force})`,
  });

  if (!enabled && !args.force) {
    await finishRun({
      runId: run.id,
      status: "skipped",
      startedAt: run.startedAt,
      metrics: { enabled, forced: args.force },
    });
    return;
  }

  try {
    if (args.agentKey === "vuln") await runVulnAgent();
    else if (args.agentKey === "vuln-scanners") await runVulnScannerSyncAgent({ connectionId: args.connectionId });
    else if (args.agentKey === "exploit") await runExploitAgent();
    else if (args.agentKey === "epss-enrich") await runEpssEnrichAgent();
    else if (args.agentKey === "attack") await runAttackAgent();
    else if (args.agentKey === "ttp") await runTtpAgent();
    else if (args.agentKey === "malware") await runMalwareAgent();
    else if (args.agentKey === "thehive") await runTheHiveSyncAgent();
    else if (args.agentKey === "actor-profile") await runActorProfileAgent();
    else if (args.agentKey === "navigator") await runNavigatorAgent();
    else if (args.agentKey === "detections") await runDetectionsAgent({ scenarioId: args.scenarioId });
    else if (args.agentKey === "merge") await runMergeAgent();
    else if (args.agentKey === "ioc-taxii") await runIocTaxiiImportAgent();
    else if (args.agentKey === "ioc-enrich") await runIocEnrichAgent();
    else if (args.agentKey === "custom-runner") {
      // Manual run should be "force" by default: let users see output immediately even if
      // their schedules wouldn't trigger right now.
      await runCustomAgents({ force: args.force });
    } else {
      throw new Error(`Unhandled agentKey: ${args.agentKey}`);
    }

    await finishRun({
      runId: run.id,
      status: "succeeded",
      startedAt: run.startedAt,
      metrics: { enabled, forced: args.force },
    });
  } catch (err) {
    await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
    await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err, metrics: { enabled, forced: args.force } });
    throw err;
  }
}

async function runCustomAgent(args: Args) {
  if (!args.customAgentId) throw new Error("--customAgentId is required for custom runs");
  const runIds = await runCustomAgents({ onlyId: args.customAgentId, force: true });
  console.log(JSON.stringify({ runIds, customAgentId: args.customAgentId }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.agentKey) throw new Error("--agentKey is required");

  if (args.agentKey === "custom") {
    await runCustomAgent(args);
    return;
  }

  await runSystemAgent(args);
}

if (process.argv[1]?.endsWith("run-on-demand.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
