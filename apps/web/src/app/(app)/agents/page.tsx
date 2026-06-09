export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, agentRuns, agentSettings, customAgents, userAiKeys } from "@ti/db";
import { and, desc, eq, or } from "drizzle-orm";
import { AgentsDashboard } from "../../../components/agents/AgentsDashboard";
import { toIsoStringSafe } from "../../../lib/dates";
import { SYSTEM_AGENTS } from "../../../lib/agents";
import { getViewerContext } from "../../../lib/tenancy";

type RunRow = {
  id: string;
  agentKey: string;
  kind: string;
  userId: string | null;
  customAgentId: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  metrics: any;
};

export default async function AgentsPage() {
  const db = getDb();
  const ctx = await getViewerContext();

  const settings = new Map<string, boolean>();
  let customRows: Array<{
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    scheduleMinutes: number;
    lastRunAt: Date | null;
    updatedAt: Date;
  }> = [];

  let runsRaw: Array<{
    id: string;
    agentKey: string;
    kind: any;
    userId: string | null;
    customAgentId: string | null;
    status: any;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    metrics: any;
  }> = [];

  let aiKey: { configured: boolean; provider: string | null; baseUrl: string | null; updatedAt: string | null; error?: string | null } =
    { configured: false, provider: null, baseUrl: null, updatedAt: null };

  try {
    const settingsRows = await db
      .select({
        agentKey: agentSettings.agentKey,
        enabled: agentSettings.enabled,
        updatedAt: agentSettings.updatedAt,
      })
      .from(agentSettings);

    for (const r of settingsRows) settings.set(r.agentKey, !!r.enabled);

    customRows = await db
      .select({
        id: customAgents.id,
        name: customAgents.name,
        description: customAgents.description,
        enabled: customAgents.enabled,
        scheduleMinutes: customAgents.scheduleMinutes,
        lastRunAt: customAgents.lastRunAt,
        updatedAt: customAgents.updatedAt,
      })
      .from(customAgents)
      .where(and(eq(customAgents.userId, ctx.user.id), eq(customAgents.projectId, ctx.project.id)))
      .orderBy(desc(customAgents.updatedAt))
      .limit(50);

    runsRaw = await db
      .select({
        id: agentRuns.id,
        agentKey: agentRuns.agentKey,
        kind: agentRuns.kind,
        userId: agentRuns.userId,
        customAgentId: agentRuns.customAgentId,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        finishedAt: agentRuns.finishedAt,
        durationMs: agentRuns.durationMs,
        metrics: agentRuns.metrics,
      })
      .from(agentRuns)
      .where(
        or(
          and(eq(agentRuns.kind, "system"), eq(agentRuns.projectId, ctx.project.id)),
          and(eq(agentRuns.userId, ctx.user.id), eq(agentRuns.projectId, ctx.project.id))
        )
      )
      .orderBy(desc(agentRuns.startedAt))
      .limit(200);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return (
        <div className="mx-auto max-w-[900px] px-8 py-10 space-y-4">
          <a href="/" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Back to dashboard
          </a>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agents</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Agent tables are not in your database yet.
          </p>
          <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-sm">
            pnpm db:migrate
          </pre>
        </div>
      );
    }
    throw err;
  }

  try {
    const [row] = await db
      .select({
        provider: userAiKeys.provider,
        baseUrl: userAiKeys.baseUrl,
        updatedAt: userAiKeys.updatedAt,
      })
      .from(userAiKeys)
      .where(and(eq(userAiKeys.userId, ctx.user.id), eq(userAiKeys.projectId, ctx.project.id)))
      .limit(1);

    aiKey = {
      configured: !!row,
      provider: row ? String(row.provider) : null,
      baseUrl: row?.baseUrl ? String(row.baseUrl) : null,
      updatedAt: toIsoStringSafe(row?.updatedAt ?? null),
    };
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      aiKey = {
        configured: false,
        provider: null,
        baseUrl: null,
        updatedAt: null,
        error: "AI key tables are missing. Run pnpm db:migrate.",
      };
    } else {
      aiKey = { configured: false, provider: null, baseUrl: null, updatedAt: null, error: "Failed to load key status." };
    }
  }

  const runs: RunRow[] = runsRaw.map((r) => ({
    id: r.id,
    agentKey: r.agentKey,
    kind: String(r.kind),
    userId: r.userId ?? null,
    customAgentId: r.customAgentId ?? null,
    status: String(r.status),
    startedAt: toIsoStringSafe(r.startedAt),
    finishedAt: toIsoStringSafe(r.finishedAt),
    durationMs: r.durationMs ?? null,
    metrics: r.metrics ?? null,
  }));

  const lastRunByAgentKey = new Map<string, RunRow>();
  const lastRunByCustomAgentId = new Map<string, RunRow>();
  for (const r of runs) {
    if (!lastRunByAgentKey.has(r.agentKey)) lastRunByAgentKey.set(r.agentKey, r);
    if (r.customAgentId && !lastRunByCustomAgentId.has(r.customAgentId)) {
      lastRunByCustomAgentId.set(r.customAgentId, r);
    }
  }

  const systemAgents = SYSTEM_AGENTS.map((a) => ({
    ...a,
    enabled: settings.get(a.key) ?? true,
    lastRun: lastRunByAgentKey.get(a.key) ?? null,
  }));

  const customAgentsView = customRows.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    enabled: !!a.enabled,
    scheduleMinutes: Number(a.scheduleMinutes ?? 1440),
    lastRunAt: toIsoStringSafe(a.lastRunAt),
    lastRun: lastRunByCustomAgentId.get(a.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-[1600px] px-8 py-10">
      <AgentsDashboard
        systemAgents={systemAgents as any}
        customAgents={customAgentsView as any}
        recentRuns={runs as any}
        viewerTier={String(ctx.user.tier)}
        aiKey={aiKey}
      />
    </div>
  );
}
