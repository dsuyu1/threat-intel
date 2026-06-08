export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { TabletopGenerateForm } from "../../../../../../components/tabletop/TabletopGenerateForm";

export default async function NewTabletopPage({ params }: { params: Promise<{ projectSlug: string }> }) {
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">New tabletop exercise</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Tabletop exercises are available on Pro.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <Link href={`/p/${p.projectSlug}/tabletop`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to tabletop
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">New tabletop exercise</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Generates a complete tabletop package from your project&apos;s Navigator gaps and stack.
        </p>
      </header>

      <TabletopGenerateForm projectSlug={p.projectSlug} />
    </div>
  );
}
