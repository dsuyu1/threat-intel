export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, navigatorConfigs } from "@ti/db";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { ComplianceSettingsEditor } from "../../../../../../components/compliance/ComplianceSettingsEditor";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";
import { COMPLIANCE_FRAMEWORKS, frameworkLabel, getComplianceSettings } from "../../../../../../lib/compliance";

export default async function ComplianceSettingsPage({
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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance settings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Audit readiness dashboards are available on Pro.</p>
      </div>
    );
  }

  const compliance = await getComplianceSettings(db as any, ctx.project.id);

  let navSector = "all";
  let crownJewels: Array<{ id: string }> = [];
  try {
    const [cfg] = await db
      .select({ sector: navigatorConfigs.sector, crownJewels: navigatorConfigs.crownJewels })
      .from(navigatorConfigs)
      .where(eq(navigatorConfigs.projectId, ctx.project.id))
      .limit(1);
    if (cfg?.sector) navSector = String(cfg.sector);
    if (Array.isArray(cfg?.crownJewels)) crownJewels = (cfg.crownJewels as any[]).map((x) => ({ id: String((x as any)?.id ?? "") }));
  } catch {
    // Optional.
  }

  const hipaaSuggested = navSector === "healthcare";
  const pciSuggested = crownJewels.some((c) => c.id === "payments");

  const suggestions = [
    {
      id: "hipaa",
      label: "HIPAA",
      reason: hipaaSuggested ? "Sector is healthcare." : "",
      available: false,
    },
    {
      id: "pci_dss",
      label: "PCI-DSS",
      reason: pciSuggested ? "Payments selected as a crown jewel." : "",
      available: false,
    },
  ];

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}/compliance`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Compliance
        </Link>
        <Link
          href={`/p/${p.projectSlug}/risk/compliance`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Manage mappings
        </Link>
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance settings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Choose which frameworks apply to this project and how requirements are inferred.
        </p>
      </div>

      {!compliance.schemaReady ? (
        <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Compliance tables are missing. Run{" "}
          <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-950/30">pnpm db:migrate</code>.
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="Frameworks" description="Enable dashboards and set requirement drivers." />
        <CardContent>
          <ComplianceSettingsEditor
            projectSlug={p.projectSlug}
            initial={{
              federalFunding: compliance.settings.federalFunding,
              cyberInsurance: compliance.settings.cyberInsurance,
              enabledFrameworks: compliance.enabled.length ? compliance.enabled : ["nist_csf_2", "cis_v8"],
            }}
            suggestions={suggestions}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Supported dashboards" description="Current frameworks available in this module." />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {COMPLIANCE_FRAMEWORKS.map((fw) => (
              <div key={fw} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-4">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{frameworkLabel(fw)}</div>
                <div className="mt-1 text-xs text-zinc-500">Coverage, gaps, and top compliance-risk scenarios.</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
