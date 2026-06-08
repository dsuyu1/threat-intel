export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { ApiKeysManager } from "../../../../../components/api/ApiKeysManager";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">API keys</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Enterprise API access is available on Pro.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/p/${p.projectSlug}`}
          className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
        >
          ← Project overview
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">API keys</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Issue API keys for external integrations (SIEM, GRC, BI). Keys are scoped and rate-limited.
        </p>
      </header>

      <Card>
        <CardHeader title="External API" description="Use Bearer auth with your issued API key." />
        <CardContent>
          <pre className="text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3 overflow-auto">
            {`curl -H "Authorization: Bearer <API_KEY>" \\
  ${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/v1/findings`}
          </pre>
        </CardContent>
      </Card>

      <ApiKeysManager projectSlug={ctx.project.slug} />
    </div>
  );
}

