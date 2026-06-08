export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, discordWebhookConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { DiscordWebhookConnections } from "../../../../components/integrations/DiscordWebhookConnections";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { getLocalUser } from "../../../../lib/local-user";
import { toIsoStringSafe } from "../../../../lib/dates";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  criteria: any;
  createdAt: string | null;
  updatedAt: string | null;
};

export default async function DiscordWebhooksPage() {
  const db = getDb();
  const user = await getLocalUser();

  let rowsRaw: Array<{
    id: string;
    name: string;
    enabled: boolean | null;
    webhookUrl: string;
    criteria: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: discordWebhookConnections.id,
        name: discordWebhookConnections.name,
        enabled: discordWebhookConnections.enabled,
        webhookUrl: discordWebhookConnections.webhookUrl,
        criteria: discordWebhookConnections.criteria,
        createdAt: discordWebhookConnections.createdAt,
        updatedAt: discordWebhookConnections.updatedAt,
      })
      .from(discordWebhookConnections)
      .where(eq(discordWebhookConnections.userId, user.id))
      .orderBy(
        desc(discordWebhookConnections.updatedAt),
        desc(discordWebhookConnections.createdAt)
      );
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingTable =
      code === "42P01" || msg.includes('relation "discord_webhook_connections"');

    if (isMissingTable) {
      return (
        <div className="mx-auto max-w-[1440px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The Discord connections table doesn't exist in your current DATABASE_URL."
            />
            <CardContent>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>Run migrations, then refresh this page:</p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
                <p className="text-zinc-600 dark:text-zinc-400">
                  If you still see this error, make sure the same{" "}
                  <span className="font-mono">DATABASE_URL</span> is set in{" "}
                  <span className="font-mono">apps/web/.env.local</span> (Next
                  dev) and is the one used when running{" "}
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
    webhookUrl: r.webhookUrl,
    criteria: r.criteria ?? {},
    createdAt: toIsoStringSafe(r.createdAt),
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10">
      <DiscordWebhookConnections rows={rows} />
    </div>
  );
}

