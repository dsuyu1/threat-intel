export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb } from "@ti/db";
import { DefendHeatmap } from "../../../../../components/navigator/DefendHeatmap";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { buildDefendHeatmapColumns } from "../../../../../lib/defend-heatmap";
import { getViewerContext } from "../../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function parseDays(value: string | undefined, fallback: number) {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 && i <= 365 ? i : fallback;
}

export default async function DefendPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const p = await params;
  const sp = await searchParams;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">MITRE matrix map</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">MITRE matrix map is available on Pro.</p>
      </div>
    );
  }

  const days = parseDays(pickOne(sp.days), 90);
  const db = getDb();
  const columns = await buildDefendHeatmapColumns({ db, days });

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">MITRE matrix map</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          ATT&CK Enterprise technique heatmap scored by findings mentions. Click a technique to see ATT&CK mitigations
          and mapped MITRE D3FEND countermeasures.
        </p>
      </div>

      <DefendHeatmap projectSlug={p.projectSlug} days={days} columns={columns} />
    </div>
  );
}
