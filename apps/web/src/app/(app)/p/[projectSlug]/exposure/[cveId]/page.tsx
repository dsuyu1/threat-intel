export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, vulnScannerAssetCves, vulnScannerAssets, vulnScannerConnections, vulnScannerCveExposures } from "@ti/db";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { toIsoStringSafe } from "../../../../../../lib/dates";
import { getViewerContext } from "../../../../../../lib/tenancy";

function normalizeCveId(input: string) {
  const s = String(input ?? "").trim().toUpperCase();
  const m = s.match(/CVE-\d{4}-\d{4,7}/);
  return m?.[0] ?? null;
}

function nf(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export default async function ExposurePage({
  params,
}: {
  params: Promise<{ projectSlug: string; cveId: string }>;
}) {
  const p = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Exposure</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Scanner exposure is available on Pro.</p>
      </div>
    );
  }

  const cveId = normalizeCveId(p.cveId);
  if (!cveId) notFound();

  const missingTablesCard = (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-10">
      <Card>
        <CardHeader title="Database not migrated" description="The vuln scanner tables don't exist yet." />
        <CardContent>
          <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            <p>Run migrations, then refresh this page:</p>
            <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  let connection: { id: string; name: string; kind: string; lastSyncedAt: Date | null } | null = null;
  try {
    const [row] = await db
      .select({
        id: vulnScannerConnections.id,
        name: vulnScannerConnections.name,
        kind: vulnScannerConnections.kind,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
        updatedAt: vulnScannerConnections.updatedAt,
      })
      .from(vulnScannerConnections)
      .where(and(eq(vulnScannerConnections.projectId, ctx.project.id), eq(vulnScannerConnections.enabled, true)))
      .orderBy(desc(vulnScannerConnections.lastSyncedAt), desc(vulnScannerConnections.updatedAt))
      .limit(1);
    connection = row?.id ? { id: row.id, name: row.name, kind: String(row.kind ?? ""), lastSyncedAt: row.lastSyncedAt ?? null } : null;
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return missingTablesCard;
    throw err;
  }

  if (!connection) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link href={`/p/${p.projectSlug}/risk`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Risk register
          </Link>
          <Link href={`/integrations/vuln-scanners`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            Manage scanners →
          </Link>
        </div>

        <Card>
          <CardHeader title="No scanner connection" description="Set up a scanner integration to see affected hosts." />
          <CardContent>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No enabled vulnerability scanner connection is configured for this project.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeSince = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

  let exposure: { affectedHostCount: number; lastSeenAtIso: string | null; computedAtIso: string | null } | null = null;
  try {
    const [row] = await db
      .select({
        affectedHostCount: vulnScannerCveExposures.affectedHostCount,
        lastSeenAt: vulnScannerCveExposures.lastSeenAt,
        computedAt: vulnScannerCveExposures.computedAt,
      })
      .from(vulnScannerCveExposures)
      .where(and(eq(vulnScannerCveExposures.projectId, ctx.project.id), eq(vulnScannerCveExposures.connectionId, connection.id), eq(vulnScannerCveExposures.cveId, cveId)))
      .limit(1);
    exposure = row
      ? {
          affectedHostCount: Number(row.affectedHostCount ?? 0),
          lastSeenAtIso: toIsoStringSafe(row.lastSeenAt),
          computedAtIso: toIsoStringSafe(row.computedAt),
        }
      : null;
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return missingTablesCard;
    throw err;
  }

  let hosts: Array<{ hostname: string | null; ipv4: string | null; os: string | null; lastSeenAtIso: string | null; severity: string | null }> = [];
  try {
    const rows = await db
      .select({
        hostname: vulnScannerAssets.hostname,
        ipv4: vulnScannerAssets.ipv4,
        os: vulnScannerAssets.os,
        lastSeenAt: vulnScannerAssetCves.lastSeenAt,
        severity: vulnScannerAssetCves.severity,
      })
      .from(vulnScannerAssetCves)
      .innerJoin(vulnScannerAssets, eq(vulnScannerAssetCves.assetId, vulnScannerAssets.id))
      .where(
        and(
          eq(vulnScannerAssetCves.projectId, ctx.project.id),
          eq(vulnScannerAssetCves.connectionId, connection.id),
          eq(vulnScannerAssetCves.cveId, cveId),
          gte(vulnScannerAssetCves.lastSeenAt, activeSince),
          sql`${vulnScannerAssetCves.status} != 'fixed'`
        )
      )
      .orderBy(desc(vulnScannerAssetCves.lastSeenAt))
      .limit(200);

    hosts = rows.map((r) => ({
      hostname: r.hostname ?? null,
      ipv4: r.ipv4 ?? null,
      os: r.os ?? null,
      lastSeenAtIso: toIsoStringSafe(r.lastSeenAt),
      severity: r.severity ? String(r.severity) : null,
    }));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return missingTablesCard;
    throw err;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link href={`/p/${p.projectSlug}/risk`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Risk register
        </Link>
        <div className="flex items-center gap-3">
          <Link href={`/integrations/vuln-scanners`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            Manage scanners →
          </Link>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Exposure: {cveId}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Data source: {connection.name} ({connection.kind}){connection.lastSyncedAt ? ` — synced ${new Date(connection.lastSyncedAt).toLocaleString("en-US")}` : ""}.
        </p>
      </header>

      <Card>
        <CardHeader title="Summary" description="Counts are based on the last 45 days of scanner evidence." />
        <CardContent>
          {exposure ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                Affected hosts:{" "}
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(exposure.affectedHostCount)}</span>
              </div>
              {exposure.lastSeenAtIso ? (
                <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                  Last seen: {new Date(exposure.lastSeenAtIso).toLocaleString("en-US")}
                </div>
              ) : null}
              {exposure.computedAtIso ? (
                <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                  Computed: {new Date(exposure.computedAtIso).toLocaleString("en-US")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No cached exposure for this CVE yet. Trigger a sync from the scanner connection page.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Hosts" description="Top affected hosts (most recently seen first)." />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="text-left font-medium py-2 pr-4">Hostname</th>
                  <th className="text-left font-medium py-2 pr-4">IP</th>
                  <th className="text-left font-medium py-2 pr-4">OS</th>
                  <th className="text-left font-medium py-2 pr-4">Severity</th>
                  <th className="text-left font-medium py-2">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                {hosts.length ? (
                  hosts.map((h, idx) => (
                    <tr key={`${h.hostname ?? "host"}:${h.ipv4 ?? "ip"}:${idx}`}>
                      <td className="py-3 pr-4 text-zinc-900 dark:text-zinc-100">{h.hostname ?? "—"}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">{h.ipv4 ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{h.os ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{h.severity ?? "—"}</td>
                      <td className="py-3 text-xs text-zinc-600 dark:text-zinc-400">
                        {h.lastSeenAtIso ? new Date(h.lastSeenAtIso).toLocaleString("en-US") : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-sm text-zinc-600 dark:text-zinc-400">
                      No affected hosts found in the last 45 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
