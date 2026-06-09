export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, vulnScannerConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { VulnScannerConnections } from "../../../../components/integrations/VulnScannerConnections";
import { toIsoStringSafe } from "../../../../lib/dates";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

type Row = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  baseUrl: string;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default async function VulnScannerConnectionsPage() {
  const db = getDb();
  const ctx = await getViewerContext();

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) {
    return (
      <div className="mx-auto max-w-[90ch] px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Vulnerability Scanners</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Scanner integrations are available on Pro.</p>
      </div>
    );
  }

  let rowsRaw: Array<{
    id: string;
    name: string;
    kind: unknown;
    enabled: boolean | null;
    baseUrl: string;
    lastSyncedAt: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: vulnScannerConnections.id,
        name: vulnScannerConnections.name,
        kind: vulnScannerConnections.kind,
        enabled: vulnScannerConnections.enabled,
        baseUrl: vulnScannerConnections.baseUrl,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
        createdAt: vulnScannerConnections.createdAt,
        updatedAt: vulnScannerConnections.updatedAt,
      })
      .from(vulnScannerConnections)
      .where(eq(vulnScannerConnections.projectId, ctx.project.id))
      .orderBy(desc(vulnScannerConnections.updatedAt), desc(vulnScannerConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingTable = code === "42P01" || msg.includes('relation "vuln_scanner_connections"');

    if (isMissingTable) {
      return (
        <div className="mx-auto max-w-[1600px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The vuln scanner tables don't exist in your current DATABASE_URL."
            />
            <CardContent>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>Run migrations, then refresh this page:</p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
                <p className="text-zinc-600 dark:text-zinc-400">
                  If you still see this error, make sure the same <span className="font-mono">DATABASE_URL</span> is set
                  in <span className="font-mono">apps/web/.env.local</span> (Next dev) and is the one used when running{" "}
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
    kind: String(r.kind ?? ""),
    enabled: !!r.enabled,
    baseUrl: r.baseUrl,
    lastSyncedAt: toIsoStringSafe(r.lastSyncedAt),
    createdAt: toIsoStringSafe(r.createdAt),
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  return (
    <div className="mx-auto max-w-[1600px] px-8 py-10">
      <VulnScannerConnections rows={rows} />
    </div>
  );
}
