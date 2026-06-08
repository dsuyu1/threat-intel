export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, splunkConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { SplunkConnections } from "../../../../components/integrations/SplunkConnections";
import { toIsoStringSafe } from "../../../../lib/dates";
import { getViewerContext } from "../../../../lib/tenancy";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  username: string;
  app: string;
  owner: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export default async function SplunkConnectionsPage() {
  const db = getDb();
  const ctx = await getViewerContext();

  let rowsRaw: Array<{
    id: string;
    name: string;
    enabled: boolean | null;
    baseUrl: string;
    username: string;
    app: string;
    owner: string;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: splunkConnections.id,
        name: splunkConnections.name,
        enabled: splunkConnections.enabled,
        baseUrl: splunkConnections.baseUrl,
        username: splunkConnections.username,
        app: splunkConnections.app,
        owner: splunkConnections.owner,
        createdAt: splunkConnections.createdAt,
        updatedAt: splunkConnections.updatedAt,
      })
      .from(splunkConnections)
      .where(eq(splunkConnections.projectId, ctx.project.id))
      .orderBy(desc(splunkConnections.updatedAt), desc(splunkConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingTable = code === "42P01" || msg.includes('relation "splunk_connections"');

    if (isMissingTable) {
      return (
        <div className="mx-auto max-w-[1440px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The Splunk connections table doesn't exist in your current DATABASE_URL."
            />
            <CardContent>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>Run migrations, then refresh this page:</p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
                <p className="text-zinc-600 dark:text-zinc-400">
                  If you still see this error, make sure the same{" "}
                  <span className="font-mono">DATABASE_URL</span> is set in{" "}
                  <span className="font-mono">apps/web/.env.local</span> (Next dev) and is the one used when running{" "}
                  <span className="font-mono">pnpm db:migrate</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    throw err;
  }

  const rows: Row[] = rowsRaw.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    baseUrl: r.baseUrl,
    username: r.username,
    app: r.app,
    owner: r.owner,
    createdAt: toIsoStringSafe(r.createdAt),
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10">
      <SplunkConnections rows={rows} />
    </div>
  );
}
