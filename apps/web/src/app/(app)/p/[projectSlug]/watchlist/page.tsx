export const runtime = "edge";
export const dynamic = "force-dynamic";

import {
  discordWebhookConnections,
  getDb,
  kgEntities,
  slackWebhookConnections,
  soarWebhookConnections,
  watchlistItems,
} from "@ti/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { WatchlistManager, type WatchlistConnectionOption, type WatchlistRow } from "../../../../../components/watchlist/WatchlistManager";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { getViewerContext } from "../../../../../lib/tenancy";
import { toIsoStringSafe } from "../../../../../lib/dates";

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  if (code === "42P01") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('relation "') && msg.includes("does not exist");
}

function distinctStrings(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export default async function WatchlistPage({ params }: { params: Promise<{ projectSlug: string }> }) {
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const db = getDb();

  let rowsRaw: Array<{
    id: string;
    enabled: boolean | null;
    kind: string;
    value: string;
    channel: string;
    connectionId: string | null;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: watchlistItems.id,
        enabled: watchlistItems.enabled,
        kind: watchlistItems.kind,
        value: watchlistItems.value,
        channel: watchlistItems.channel,
        connectionId: watchlistItems.connectionId,
        createdAt: watchlistItems.createdAt,
        updatedAt: watchlistItems.updatedAt,
      })
      .from(watchlistItems)
      .where(and(eq(watchlistItems.projectId, ctx.project.id), eq(watchlistItems.userId, ctx.user.id)))
      .orderBy(desc(watchlistItems.updatedAt), desc(watchlistItems.createdAt))
      .limit(500);
  } catch (err) {
    if (isMissingTable(err)) {
      return (
        <div className="mx-auto max-w-[1600px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The watchlist tables don't exist in your current DATABASE_URL."
            />
            <CardContent>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>Run migrations, then refresh this page:</p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
  }

  const [slackConns, discordConns, soarConns] = await Promise.all([
    db
      .select({ id: slackWebhookConnections.id, name: slackWebhookConnections.name, enabled: slackWebhookConnections.enabled })
      .from(slackWebhookConnections)
      .where(and(eq(slackWebhookConnections.projectId, ctx.project.id), eq(slackWebhookConnections.userId, ctx.user.id)))
      .orderBy(asc(slackWebhookConnections.name))
      .limit(200)
      .catch(() => []),
    db
      .select({ id: discordWebhookConnections.id, name: discordWebhookConnections.name, enabled: discordWebhookConnections.enabled })
      .from(discordWebhookConnections)
      .where(and(eq(discordWebhookConnections.projectId, ctx.project.id), eq(discordWebhookConnections.userId, ctx.user.id)))
      .orderBy(asc(discordWebhookConnections.name))
      .limit(200)
      .catch(() => []),
    db
      .select({ id: soarWebhookConnections.id, name: soarWebhookConnections.name, enabled: soarWebhookConnections.enabled })
      .from(soarWebhookConnections)
      .where(and(eq(soarWebhookConnections.projectId, ctx.project.id), eq(soarWebhookConnections.userId, ctx.user.id)))
      .orderBy(asc(soarWebhookConnections.name))
      .limit(200)
      .catch(() => []),
  ]);

  const connections: WatchlistConnectionOption[] = [
    ...slackConns.map((c) => ({ id: c.id, name: c.name, kind: "slack" as const, enabled: !!c.enabled })),
    ...discordConns.map((c) => ({ id: c.id, name: c.name, kind: "discord" as const, enabled: !!c.enabled })),
    ...soarConns.map((c) => ({ id: c.id, name: c.name, kind: "soar" as const, enabled: !!c.enabled })),
  ];

  const actorIds = distinctStrings(rowsRaw.filter((r) => String(r.kind) === "actor").map((r) => r.value));
  const techniqueIds = distinctStrings(rowsRaw.filter((r) => String(r.kind) === "technique").map((r) => r.value));
  const cveIds = distinctStrings(rowsRaw.filter((r) => String(r.kind) === "cve").map((r) => r.value));

  const [actors, techniques, cves] = await Promise.all([
    actorIds.length
      ? db
          .select({ id: kgEntities.entityId, name: kgEntities.name })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "actor"), inArray(kgEntities.entityId, actorIds)))
          .limit(500)
          .catch(() => [])
      : Promise.resolve([]),
    techniqueIds.length
      ? db
          .select({ id: kgEntities.entityId, name: kgEntities.name })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "technique"), inArray(kgEntities.entityId, techniqueIds)))
          .limit(800)
          .catch(() => [])
      : Promise.resolve([]),
    cveIds.length
      ? db
          .select({ id: kgEntities.entityId, name: kgEntities.name })
          .from(kgEntities)
          .where(and(eq(kgEntities.kind, "cve"), inArray(kgEntities.entityId, cveIds)))
          .limit(1200)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const labelByEntityId = new Map<string, string>();
  for (const a of actors) labelByEntityId.set(a.id, a.name);
  for (const t of techniques) labelByEntityId.set(t.id, t.name);
  for (const c of cves) labelByEntityId.set(c.id, c.name);

  const connLabelByKey = new Map<string, string>();
  for (const c of connections) connLabelByKey.set(`${c.kind}::${c.id}`, c.name);

  const rows: WatchlistRow[] = rowsRaw.map((r) => {
    const kind = String(r.kind);
    const value = String(r.value ?? "").trim();
    const entityName = labelByEntityId.get(value) ?? null;
    const label =
      kind === "actor" && entityName
        ? `${entityName} (${value})`
        : kind === "technique" && entityName
          ? `${value} — ${entityName}`
          : kind === "cve" && entityName && entityName !== value
            ? `${value} — ${entityName}`
            : value;

    const channel = String(r.channel);
    const connectionId = r.connectionId ? String(r.connectionId) : null;
    const connectionLabel = connectionId ? (connLabelByKey.get(`${channel}::${connectionId}`) ?? connectionId) : null;

    return {
      id: r.id,
      enabled: !!r.enabled,
      kind: kind as any,
      value,
      label,
      channel: channel as any,
      connectionId,
      connectionLabel,
      createdAt: toIsoStringSafe(r.createdAt),
      updatedAt: toIsoStringSafe(r.updatedAt),
    };
  });

  return (
    <div className="mx-auto max-w-[1600px] px-8 py-10">
      <WatchlistManager projectSlug={p.projectSlug} rows={rows} connections={connections} />
    </div>
  );
}
