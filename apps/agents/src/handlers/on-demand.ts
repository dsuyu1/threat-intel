import type { Context } from "aws-lambda";

import { agentRuns, customAgents, getDb } from "@ti/db";
import { and, eq } from "drizzle-orm";

import { runAttackAgent } from "../agents/attack.js";
import { runCustomAgents } from "../agents/custom.js";
import { runDetectionsAgent } from "../agents/detections.js";
import { runExploitAgent } from "../agents/exploit.js";
import { runEpssEnrichAgent } from "../agents/epss-enrich.js";
import { runMalwareAgent } from "../agents/malware.js";
import { runMergeAgent } from "../agents/merge.js";
import { runNavigatorAgent } from "../agents/navigator.js";
import { runActorProfileAgent } from "../agents/profile.js";
import { runTtpAgent } from "../agents/ttp.js";
import { runVulnAgent } from "../agents/vuln.js";
import { runVulnScannerSyncAgent } from "../agents/vuln-scanners.js";
import { runIocTaxiiImportAgent } from "../agents/ioc-taxii.js";
import { runIocEnrichAgent } from "../agents/ioc-enrich.js";
import { finishRun, isAgentEnabled, logRunEvent } from "../lib/agent-runs.js";

type OnDemandKind = "system" | "custom";
type SystemAgentKey =
  | "vuln"
  | "vuln-scanners"
  | "exploit"
  | "epss-enrich"
  | "attack"
  | "ttp"
  | "malware"
  | "actor-profile"
  | "navigator"
  | "detections"
  | "merge"
  | "ioc-taxii"
  | "ioc-enrich"
  | "custom-runner";

type OnDemandEventV1 = {
  version?: 1;
  runId?: string;
  kind?: OnDemandKind;
  agentKey?: string;
  customAgentId?: string;
  projectId?: string;
  userId?: string;
  scenarioId?: string;
  connectionId?: string;
  force?: boolean;
};

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function isSystemKey(key: string): key is SystemAgentKey {
  return (
    key === "vuln" ||
    key === "vuln-scanners" ||
    key === "exploit" ||
    key === "epss-enrich" ||
    key === "attack" ||
    key === "ttp" ||
    key === "malware" ||
    key === "actor-profile" ||
    key === "navigator" ||
    key === "detections" ||
    key === "merge" ||
    key === "ioc-taxii" ||
    key === "ioc-enrich" ||
    key === "custom-runner"
  );
}

async function loadRun(runId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: agentRuns.id,
      agentKey: agentRuns.agentKey,
      kind: agentRuns.kind,
      projectId: agentRuns.projectId,
      userId: agentRuns.userId,
      customAgentId: agentRuns.customAgentId,
      startedAt: agentRuns.startedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  return row ?? null;
}

async function ensureCustomAgentOwnership(params: { customAgentId: string; projectId: string; userId: string }) {
  const db = getDb();
  const [row] = await db
    .select({ id: customAgents.id })
    .from(customAgents)
    .where(
      and(eq(customAgents.id, params.customAgentId), eq(customAgents.projectId, params.projectId), eq(customAgents.userId, params.userId))
    )
    .limit(1);
  if (!row?.id) throw new Error("Custom agent not found or not authorized");
}

export const handler = async (event: OnDemandEventV1, _ctx: Context): Promise<void> => {
  const e = (event ?? {}) as OnDemandEventV1;
  const kind = asString(e.kind);
  const runId = asString(e.runId);
  const force = e.force !== false;

  if (kind !== "system" && kind !== "custom") {
    throw new Error("kind must be 'system' or 'custom'");
  }
  if (!runId) {
    throw new Error("runId is required");
  }

  const run = await loadRun(runId);
  if (!run) throw new Error("Run not found");

  try {
    if (kind === "custom") {
      const customAgentId = asString(e.customAgentId);
      const projectId = asString(e.projectId || run.projectId);
      const userId = asString(e.userId || run.userId);
      if (!customAgentId) throw new Error("customAgentId is required");
      if (!projectId) throw new Error("projectId is required");
      if (!userId) throw new Error("userId is required");

      if (String(run.kind) !== "custom") throw new Error("Run kind mismatch");
      if (String(run.agentKey) !== "custom") throw new Error("Run agentKey mismatch");
      if (String(run.customAgentId ?? "") !== customAgentId) throw new Error("Run customAgentId mismatch");

      await ensureCustomAgentOwnership({ customAgentId, projectId, userId });
      await logRunEvent({ runId, message: "Started (custom agent)" });

      const runIds = await runCustomAgents({ onlyId: customAgentId, force, runId });
      if (!runIds.length) {
        await logRunEvent({ runId, message: "Skipped (not due)" });
        await finishRun({ runId, status: "skipped", startedAt: run.startedAt, metrics: { forced: force } });
      }

      return;
    }

    // kind === "system"
    const agentKey = asString(e.agentKey);
    const scenarioId = asString(e.scenarioId);
    const connectionId = asString(e.connectionId);
    if (!agentKey) throw new Error("agentKey is required");
    if (!isSystemKey(agentKey)) throw new Error(`Unsupported agentKey: ${agentKey}`);

    if (String(run.kind) !== "system") throw new Error("Run kind mismatch");
    if (String(run.agentKey) !== agentKey) throw new Error("Run agentKey mismatch");

    const enabled = await isAgentEnabled(agentKey);
    await logRunEvent({ runId, message: `Started (enabled=${enabled}, forced=${force})` });

    if (!enabled && !force) {
      await finishRun({ runId, status: "skipped", startedAt: run.startedAt, metrics: { enabled, forced: force } });
      return;
    }

    if (agentKey === "vuln") await runVulnAgent();
    else if (agentKey === "vuln-scanners") await runVulnScannerSyncAgent({ connectionId: connectionId || null });
    else if (agentKey === "exploit") await runExploitAgent();
    else if (agentKey === "epss-enrich") await runEpssEnrichAgent();
    else if (agentKey === "attack") await runAttackAgent();
    else if (agentKey === "ttp") await runTtpAgent();
    else if (agentKey === "malware") await runMalwareAgent();
    else if (agentKey === "actor-profile") await runActorProfileAgent();
    else if (agentKey === "navigator") await runNavigatorAgent();
    else if (agentKey === "detections") await runDetectionsAgent({ scenarioId: scenarioId || null });
    else if (agentKey === "merge") await runMergeAgent();
    else if (agentKey === "ioc-taxii") await runIocTaxiiImportAgent();
    else if (agentKey === "ioc-enrich") await runIocEnrichAgent();
    else if (agentKey === "custom-runner") await runCustomAgents({ force });
    else throw new Error(`Unhandled agentKey: ${agentKey}`);

    await finishRun({ runId, status: "succeeded", startedAt: run.startedAt, metrics: { enabled, forced: force } });
  } catch (err) {
    await logRunEvent({ runId, level: "error", message: "Failed" });
    await finishRun({ runId, status: "failed", startedAt: run.startedAt, error: err });
    throw err;
  }
};
