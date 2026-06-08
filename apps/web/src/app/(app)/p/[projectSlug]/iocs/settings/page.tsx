export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, iocEnrichmentKeys, iocTaxiiConnections } from "@ti/db";
import { asc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { IocEnrichmentKeysManager } from "../../../../../../components/iocs/IocEnrichmentKeysManager";
import { TaxiiConnectionsManager } from "../../../../../../components/iocs/TaxiiConnectionsManager";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

export default async function IocSettingsPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOC settings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">IOC management is available on Pro.</p>
      </div>
    );
  }

  let connections: Array<{
    id: string;
    name: string;
    enabled: boolean;
    apiRootUrl: string;
    collectionId: string;
    authScheme: string;
    username: string | null;
    lookbackDays: number;
    lastSyncedAt: Date | null;
    updatedAt: Date;
  }> = [];

  let keys: Array<{
    id: string;
    provider: string;
    enabled: boolean;
    updatedAt: Date;
  }> = [];

  try {
    connections = await db
      .select({
        id: iocTaxiiConnections.id,
        name: iocTaxiiConnections.name,
        enabled: iocTaxiiConnections.enabled,
        apiRootUrl: iocTaxiiConnections.apiRootUrl,
        collectionId: iocTaxiiConnections.collectionId,
        authScheme: iocTaxiiConnections.authScheme,
        username: iocTaxiiConnections.username,
        lookbackDays: iocTaxiiConnections.lookbackDays,
        lastSyncedAt: iocTaxiiConnections.lastSyncedAt,
        updatedAt: iocTaxiiConnections.updatedAt,
      })
      .from(iocTaxiiConnections)
      .where(eq(iocTaxiiConnections.projectId, ctx.project.id))
      .orderBy(asc(iocTaxiiConnections.name))
      .limit(200);

    keys = await db
      .select({
        id: iocEnrichmentKeys.id,
        provider: iocEnrichmentKeys.provider,
        enabled: iocEnrichmentKeys.enabled,
        updatedAt: iocEnrichmentKeys.updatedAt,
      })
      .from(iocEnrichmentKeys)
      .where(eq(iocEnrichmentKeys.projectId, ctx.project.id))
      .orderBy(asc(iocEnrichmentKeys.provider))
      .limit(20);
  } catch (err) {
    if (isMissingTable(err)) {
      return (
        <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
          <Link href={`/p/${p.projectSlug}/iocs`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← IOCs
          </Link>
          <Card>
            <CardHeader title="Database not migrated" description="IOC tables are missing in your current DATABASE_URL." />
            <CardContent>
              <pre className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-sm">
                pnpm db:migrate
              </pre>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}/iocs`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← IOCs
        </Link>
        <Link href={`/p/${p.projectSlug}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          Project overview
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOC settings</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Configure TAXII feed imports and per-project enrichment API keys.
        </p>
      </header>

      <Card>
        <CardHeader title="Enrichment keys" description="Stored encrypted (TI_SECRETS_KEY). Used by the enrichment agent." />
        <CardContent>
          <IocEnrichmentKeysManager projectSlug={p.projectSlug} initialKeys={keys} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="TAXII connections" description="Enable one or more TAXII 2.1 feeds (OpenCTI-compatible)." />
        <CardContent>
          <TaxiiConnectionsManager projectSlug={p.projectSlug} initialConnections={connections} />
        </CardContent>
      </Card>
    </div>
  );
}
