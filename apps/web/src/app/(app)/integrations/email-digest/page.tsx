export const runtime = "edge";
export const dynamic = "force-dynamic";

import { emailDigestConnections, getDb } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { EmailDigestConnections } from "../../../../components/integrations/EmailDigestConnections";
import { toIsoStringSafe } from "../../../../lib/dates";
import { getViewerContext } from "../../../../lib/tenancy";

type Row = {
  id: string;
  name: string;
  enabled: boolean;
  recipients: string[];
  frequency: string;
  sendHour: number;
  timezone: string;
  criteria: any;
  lastSentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default async function EmailDigestPage() {
  const db = getDb();
  const ctx = await getViewerContext();

  let rowsRaw: Array<{
    id: string;
    name: string;
    enabled: boolean | null;
    recipients: unknown;
    frequency: unknown;
    sendHour: unknown;
    timezone: unknown;
    criteria: unknown;
    lastSentAt: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  }> = [];

  try {
    rowsRaw = await db
      .select({
        id: emailDigestConnections.id,
        name: emailDigestConnections.name,
        enabled: emailDigestConnections.enabled,
        recipients: emailDigestConnections.recipients,
        frequency: emailDigestConnections.frequency,
        sendHour: emailDigestConnections.sendHour,
        timezone: emailDigestConnections.timezone,
        criteria: emailDigestConnections.criteria,
        lastSentAt: emailDigestConnections.lastSentAt,
        createdAt: emailDigestConnections.createdAt,
        updatedAt: emailDigestConnections.updatedAt,
      })
      .from(emailDigestConnections)
      .where(eq(emailDigestConnections.projectId, ctx.project.id))
      .orderBy(desc(emailDigestConnections.updatedAt), desc(emailDigestConnections.createdAt));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingTable = code === "42P01" || msg.includes('relation "email_digest_connections"');

    if (isMissingTable) {
      return (
        <div className="mx-auto max-w-[1440px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The email digest connections table doesn't exist in your current DATABASE_URL."
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
    recipients: Array.isArray(r.recipients) ? (r.recipients as any).map(String).filter(Boolean) : [],
    frequency: String(r.frequency ?? "daily"),
    sendHour: typeof r.sendHour === "number" ? r.sendHour : Number(r.sendHour ?? 8),
    timezone: String(r.timezone ?? "UTC"),
    criteria: r.criteria ?? {},
    lastSentAt: toIsoStringSafe(r.lastSentAt),
    createdAt: toIsoStringSafe(r.createdAt),
    updatedAt: toIsoStringSafe(r.updatedAt),
  }));

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10">
      <EmailDigestConnections rows={rows} defaultRecipient={ctx.user.email} />
    </div>
  );
}

