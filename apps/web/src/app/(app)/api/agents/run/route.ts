export const runtime = "nodejs";

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { getDb, agentRuns, customAgents, userAiKeys } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { SYSTEM_AGENTS, type SystemAgentKey } from "../../../../../lib/agents";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isSystemAgentKey(v: string): v is SystemAgentKey {
  return SYSTEM_AGENTS.some((a) => a.key === v);
}

async function ensureAgentTablesExist() {
  const db = getDb();
  // Simple probe: if agent_runs doesn't exist, we can't run/record runs.
  await db.select({ id: agentRuns.id }).from(agentRuns).limit(1);
}

async function ensureCustomAgentAccess(params: { customAgentId: string; viewer: Awaited<ReturnType<typeof getViewerContext>> }) {
  const db = getDb();
  const viewer = params.viewer;

  const proAccess = hasNavigatorAccess({ tier: viewer.user.tier });
  let hasKey = false;
  try {
    const [row] = await db
      .select({ id: userAiKeys.id })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, viewer.user.id), eq(userAiKeys.projectId, viewer.project.id)))
      .limit(1);
    hasKey = !!row;
  } catch {
    hasKey = false;
  }
  if (!proAccess && !hasKey) {
    return { ok: false as const, status: 403 as const, error: "Custom agents require Pro or your own API key (Agents → Your API key)." };
  }

  const [owner] = await db
    .select({ userId: customAgents.userId, projectId: customAgents.projectId })
    .from(customAgents)
    .where(eq(customAgents.id, params.customAgentId))
    .limit(1);

  if (!owner) return { ok: false as const, status: 404 as const, error: "Agent not found" };
  if (owner.userId !== viewer.user.id) return { ok: false as const, status: 403 as const, error: "Not authorized" };
  if (owner.projectId !== viewer.project.id) return { ok: false as const, status: 403 as const, error: "Not authorized" };

  return { ok: true as const };
}

function awsRegion() {
  const region = String(process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "").trim();
  return region || null;
}

function onDemandFunctionName() {
  const name = String(process.env["AGENTS_ON_DEMAND_LAMBDA_NAME"] ?? process.env["AGENTS_ON_DEMAND_LAMBDA_ARN"] ?? "").trim();
  return name || null;
}

async function enqueueOnDemandRun(payload: unknown) {
  const region = awsRegion();
  const functionName = onDemandFunctionName();
  if (!region) throw new Error("AWS_REGION is not set");
  if (!functionName) throw new Error("AGENTS_ON_DEMAND_LAMBDA_NAME is not set");

  const client = new LambdaClient({ region });
  const res = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload), "utf8"),
    })
  );

  if (typeof res.StatusCode === "number" && res.StatusCode >= 200 && res.StatusCode < 300) return;
  throw new Error(`Lambda invoke failed (status=${res.StatusCode ?? "unknown"})`);
}

async function markRunFailed(params: { runId: string; startedAt: Date; err: unknown }) {
  const db = getDb();
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - new Date(params.startedAt).getTime());
  const error = String((params.err as any)?.stack ?? (params.err as any)?.message ?? params.err ?? "Unknown error").slice(0, 20_000);

  await db
    .update(agentRuns)
    .set({ status: "failed" as any, finishedAt, durationMs, error })
    .where(eq(agentRuns.id, params.runId));
}

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  const body = (await req.json().catch(() => null)) as any;

  const kind = String(body?.kind ?? "").trim().toLowerCase();

  try {
    await ensureAgentTablesExist();
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    return json({ error: "Failed to validate agent tables" }, { status: 500 });
  }

  if (kind === "custom") {
    const customAgentId = String(body?.customAgentId ?? "").trim();
    if (!customAgentId) return json({ error: "customAgentId is required" }, { status: 400 });

    try {
      const access = await ensureCustomAgentAccess({ customAgentId, viewer });
      if (!access.ok) return json({ error: access.error }, { status: access.status });
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") {
        return json({ error: "Agent tables are missing. Run pnpm db:migrate." }, { status: 503 });
      }
      return json({ error: "Failed to validate custom agent access" }, { status: 500 });
    }

    const db = getDb();
    const [run] = await db
      .insert(agentRuns)
      .values({
        agentKey: "custom",
        kind: "custom" as any,
        projectId: viewer.project.id,
        userId: viewer.user.id,
        systemRun: false,
        customAgentId,
        status: "running" as any,
        startedAt: new Date(),
      })
      .returning({ id: agentRuns.id, startedAt: agentRuns.startedAt });

    if (!run?.id) return json({ error: "Failed to create run" }, { status: 500 });

    try {
      await enqueueOnDemandRun({
        version: 1,
        kind: "custom",
        runId: run.id,
        customAgentId,
        projectId: viewer.project.id,
        userId: viewer.user.id,
        force: true,
      });
    } catch (err) {
      await markRunFailed({ runId: run.id, startedAt: run.startedAt, err });
      return json({ error: "Failed to enqueue run" }, { status: 503 });
    }

    return json({ ok: true, runId: run.id });
  }

  if (kind === "system") {
    const agentKey = String(body?.agentKey ?? "").trim();
    const scenarioId = String(body?.scenarioId ?? "").trim();
    const connectionId = String(body?.connectionId ?? "").trim();
    if (!agentKey) return json({ error: "agentKey is required" }, { status: 400 });
    if (!isSystemAgentKey(agentKey)) return json({ error: "Unknown agentKey" }, { status: 400 });

    const db = getDb();
    const [run] = await db
      .insert(agentRuns)
      .values({
        agentKey,
        kind: "system" as any,
        projectId: viewer.project.id,
        userId: viewer.user.id,
        systemRun: false,
        status: "running" as any,
        startedAt: new Date(),
      })
      .returning({ id: agentRuns.id, startedAt: agentRuns.startedAt });

    if (!run?.id) return json({ error: "Failed to create run" }, { status: 500 });

    try {
      await enqueueOnDemandRun({
        version: 1,
        kind: "system",
        runId: run.id,
        agentKey,
        scenarioId: scenarioId || undefined,
        connectionId: connectionId || undefined,
        projectId: viewer.project.id,
        userId: viewer.user.id,
        force: true,
      });
    } catch (err) {
      await markRunFailed({ runId: run.id, startedAt: run.startedAt, err });
      return json({ error: "Failed to enqueue run" }, { status: 503 });
    }

    return json({ ok: true, runId: run.id });
  }

  return json({ error: "kind must be 'system' or 'custom'" }, { status: 400 });
}
