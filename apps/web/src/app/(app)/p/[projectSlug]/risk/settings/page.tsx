export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, riskToleranceProfiles } from "@ti/db";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { RiskToleranceEditor } from "../../../../../../components/risk/RiskToleranceEditor";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

export default async function RiskSettingsPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const p = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Risk settings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Risk management is available on Pro.</p>
      </div>
    );
  }

  const defaults = { operational: 60, financial: 60, compliance: 50, reputational: 50 };
  let profile = { ...defaults };
  let tableMissing = false;

  try {
    const [row] = await db
      .select({
        operational: riskToleranceProfiles.operationalThreshold,
        financial: riskToleranceProfiles.financialThreshold,
        compliance: riskToleranceProfiles.complianceThreshold,
        reputational: riskToleranceProfiles.reputationalThreshold,
      })
      .from(riskToleranceProfiles)
      .where(eq(riskToleranceProfiles.projectId, ctx.project.id))
      .limit(1);

    if (row) {
      profile = {
        operational: Number(row.operational ?? defaults.operational),
        financial: Number(row.financial ?? defaults.financial),
        compliance: Number(row.compliance ?? defaults.compliance),
        reputational: Number(row.reputational ?? defaults.reputational),
      };
    }
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") tableMissing = true;
    else throw err;
  }

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/p/${p.projectSlug}/risk`}
          className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
        >
          ← Risk register
        </Link>
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Risk tolerance</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Set the residual score threshold (0–100) that’s acceptable per category. Items over tolerance are highlighted
          in the register.
        </p>
      </div>

      <Card className="mt-6">
        <CardHeader title="Tolerance profile" description="Applies to risk entries by category." />
        <CardContent>
          {tableMissing ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Risk tolerance tables are missing. Run{" "}
              <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900">pnpm db:migrate</code>.
            </div>
          ) : (
            <RiskToleranceEditor projectSlug={p.projectSlug} initial={profile} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
