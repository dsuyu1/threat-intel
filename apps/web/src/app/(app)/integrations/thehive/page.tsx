export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, thehiveConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { TheHiveConnections } from "../../../../components/integrations/TheHiveConnections";
import { toIsoStringSafe } from "../../../../lib/dates";
import { getViewerContext } from "../../../../lib/tenancy";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  authScheme: string;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default async function TheHiveConnectionsPage() {
  const db = getDb();
  const ctx = await getViewerContext();

  let rowsRaw: Array<{
    id: string;
    name: string;
    enabled: boolean | null;
    baseUrl: string;
    authScheme: string | null;
    lastSyncedAt: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: thehiveConnections.id,
        name: thehiveConnections.name,
        enabled: thehiveConnections.enabled,
        baseUrl: thehiveConnections.baseUrl,
        authScheme: thehiveConnections.authScheme,
        lastSyncedAt: thehiveConnections.lastSyncedAt,
        createdAt: thehiveConnections.createdAt,
        updatedAt: thehiveConnections.updatedAt,
      })
      .from(thehiveConnections)
      .where(eq(thehiveConnections.projectId, ctx.project.id))
      .orderBy(desc(thehiveConnections.updatedAt), desc(thehiveConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingTable = code === "42P01" || msg.includes('relation "thehive_connections"');

    if (isMissingTable) {
      return (
        <div className="mx-auto max-w-[1600px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The TheHive connections table doesn't exist in your current DATABASE_URL."
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
    name: r.name ?? "",
    enabled: !!r.enabled,
    baseUrl: r.baseUrl ?? "",
    authScheme: r.authScheme ? String(r.authScheme) : "bearer",
    lastSyncedAt: toIsoStringSafe(r.lastSyncedAt),
    createdAt: toIsoStringSafe(r.createdAt),
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  return (
    <div className="mx-auto max-w-[1600px] px-8 py-10">
      <TheHiveConnections rows={rows} />
    </div>
  );
}
