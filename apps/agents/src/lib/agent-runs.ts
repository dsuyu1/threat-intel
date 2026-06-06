import { getDb, agentRuns, agentRunEvents, agentSettings, projects } from "@ti/db";
import { asc, eq } from "drizzle-orm";

export type AgentRunStatus = "running" | "succeeded" | "failed" | "skipped";
export type AgentKind = "system" | "custom";

let _systemProjectId: string | null = null;

async function getSystemProjectId(): Promise<string> {
  if (_systemProjectId) return _systemProjectId;
  const db = getDb();
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .orderBy(asc(projects.createdAt))
    .limit(1);
  if (!row?.id) {
    throw new Error("No projects exist yet. Start the web app once to create the default project, then retry.");
  }
  _systemProjectId = row.id;
  return row.id;
}

export async function isAgentEnabled(agentKey: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ enabled: agentSettings.enabled })
    .from(agentSettings)
    .where(eq(agentSettings.agentKey, agentKey))
    .limit(1);
  return row ? !!row.enabled : true;
}

export async function startRun(params: {
  agentKey: string;
  kind?: AgentKind;
  projectId?: string;
  userId?: string | null;
  customAgentId?: string | null;
}) {
  const db = getDb();
  const projectId = params.projectId ?? (await getSystemProjectId());
  const [row] = await db
    .insert(agentRuns)
    .values({
      agentKey: params.agentKey,
      kind: (params.kind ?? "system") as any,
      projectId,
      userId: params.userId ?? undefined,
      customAgentId: params.customAgentId ?? undefined,
      status: "running" as any,
      startedAt: new Date(),
    })
    .returning({ id: agentRuns.id, startedAt: agentRuns.startedAt });

  if (!row?.id) throw new Error("Failed to start agent run");
  return row;
}

export async function logRunEvent(params: {
  runId: string;
  message: string;
  level?: "info" | "warn" | "error";
  progress?: number | null;
}) {
  const db = getDb();
  await db.insert(agentRunEvents).values({
    runId: params.runId,
    message: params.message,
    level: params.level ?? "info",
    progress: typeof params.progress === "number" ? Math.round(params.progress) : undefined,
  });
}

export async function finishRun(params: {
  runId: string;
  status: AgentRunStatus;
  startedAt: Date;
  error?: unknown;
  metrics?: unknown;
}) {
  const db = getDb();
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - params.startedAt.getTime());

  const errorText =
    params.status === "failed"
      ? String((params.error as any)?.stack ?? (params.error as any)?.message ?? params.error ?? "Unknown error")
          .slice(0, 20_000)
      : null;

  await db
    .update(agentRuns)
    .set({
      status: params.status as any,
      finishedAt,
      durationMs,
      error: errorText ?? undefined,
      metrics: params.metrics as any,
    })
    .where(eq(agentRuns.id, params.runId));
}
