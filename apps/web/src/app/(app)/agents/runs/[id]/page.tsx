export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, agentOutputs, agentRunEvents, agentRuns } from "@ti/db";
import { asc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { toIsoStringSafe } from "../../../../../lib/dates";
import { getLocalUser } from "../../../../../lib/local-user";

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const user = await getLocalUser();

  let run:
    | {
        id: string;
        agentKey: string;
        kind: any;
        userId: string | null;
        customAgentId: string | null;
        status: any;
        startedAt: Date;
        finishedAt: Date | null;
        durationMs: number | null;
        error: string | null;
        metrics: any;
      }
    | undefined;

  try {
    [run] = await db
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
        error: agentRuns.error,
        metrics: agentRuns.metrics,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, id))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      return (
        <div className="mx-auto max-w-[900px] px-8 py-10 space-y-4">
          <a href="/agents" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Back to Agents
          </a>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agent run</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Agent tables are not in your database yet.</p>
          <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-sm">
            pnpm db:migrate
          </pre>
        </div>
      );
    }
    throw err;
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-[900px] px-8 py-10">
        <a href="/agents" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to Agents
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Run not found</h1>
      </div>
    );
  }

  const canView = run.kind === "system" || run.userId === user.id;
  if (!canView) {
    return (
      <div className="mx-auto max-w-[900px] px-8 py-10">
        <a href="/agents" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to Agents
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Not authorized</h1>
      </div>
    );
  }

  const [output] = await db
    .select({
      id: agentOutputs.id,
      format: agentOutputs.format,
      content: agentOutputs.content,
      createdAt: agentOutputs.createdAt,
    })
    .from(agentOutputs)
    .where(eq(agentOutputs.runId, run.id))
    .limit(1);

  const events = await db
    .select({
      id: agentRunEvents.id,
      at: agentRunEvents.at,
      level: agentRunEvents.level,
      message: agentRunEvents.message,
      progress: agentRunEvents.progress,
    })
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, run.id))
    .orderBy(asc(agentRunEvents.at))
    .limit(200);

  const startedAt = toIsoStringSafe(run.startedAt);
  const finishedAt = toIsoStringSafe(run.finishedAt);

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <a href="/agents" className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to Agents
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agent run</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {run.kind === "custom" ? "custom" : run.agentKey} · {String(run.status)}
        </p>
      </header>

      <Card>
        <CardHeader title="Details" description="Timing, status, and metrics." />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Started</div>
              <div className="mt-1 tabular-nums">{startedAt ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Finished</div>
              <div className="mt-1 tabular-nums">{finishedAt ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Duration</div>
              <div className="mt-1 tabular-nums">
                {typeof run.durationMs === "number" ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Agent key</div>
              <div className="mt-1">{run.agentKey}</div>
            </div>
          </div>

          {run.metrics ? (
            <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-xs text-zinc-700 dark:text-zinc-200">
              {JSON.stringify(run.metrics, null, 2)}
            </pre>
          ) : null}

          {run.error ? (
            <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-800 dark:text-rose-200">
              {run.error}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Output" description="Latest generated output for this run." />
        <CardContent>
          {output ? (
            <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-sm text-zinc-800 dark:text-zinc-100">
              {output.content}
            </pre>
          ) : (
            <p className="text-sm text-zinc-500">No output saved for this run.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Activity" description="Progress messages emitted during the run." />
        <CardContent>
          {events.length ? (
            <div className="space-y-2 text-sm">
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-3">
                  <div className="w-[140px] shrink-0 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {toIsoStringSafe(e.at) ?? "—"}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-zinc-500">{String(e.level).toUpperCase()}</span>{" "}
                    {e.progress !== null && e.progress !== undefined ? (
                      <span className="text-xs text-zinc-500 tabular-nums">{e.progress}%</span>
                    ) : null}
                    <div className="text-zinc-800 dark:text-zinc-100">{e.message}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No events.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
