export const runtime = "nodejs";

import { spawn } from "node:child_process";

import { getDb, agentRuns, customAgents, userAiKeys } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { SYSTEM_AGENTS, type SystemAgentKey } from "../../../../lib/agents";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isSystemAgentKey(v: string): v is SystemAgentKey {
  return SYSTEM_AGENTS.some((a) => a.key === v);
}

function pnpmCmd() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
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

    const child = spawn(
      pnpmCmd(),
      ["--filter", "agents", "run:on-demand", "--", "--agentKey", "custom", "--customAgentId", customAgentId, "--userId", viewer.user.id],
      {
        cwd: process.cwd(),
        env: { ...process.env, TI_PROJECT_ID: viewer.project.id },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();
    return json({ ok: true });
  }

  if (kind === "system") {
    const agentKey = String(body?.agentKey ?? "").trim();
    if (!agentKey) return json({ error: "agentKey is required" }, { status: 400 });
    if (!isSystemAgentKey(agentKey)) return json({ error: "Unknown agentKey" }, { status: 400 });

    const child = spawn(
      pnpmCmd(),
      [
        "--filter",
        "agents",
        "run:on-demand",
        "--",
        "--agentKey",
        agentKey,
        "--projectId",
        viewer.project.id,
        "--userId",
        viewer.user.id,
        "--force",
        "1",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TI_PROJECT_ID: viewer.project.id },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();
    return json({ ok: true });
  }

  return json({ error: "kind must be 'system' or 'custom'" }, { status: 400 });
}

