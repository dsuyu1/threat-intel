export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, navigatorConfigs } from "@ti/db";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";
import { COMPLIANCE_FRAMEWORKS, computeComplianceFrameworkDashboard, frameworkLabel, getComplianceSettings } from "../../../../../lib/compliance";

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function ComplianceOverviewPage({
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
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Audit readiness dashboards are available on Pro.</p>
      </div>
    );
  }

  const compliance = await getComplianceSettings(db as any, ctx.project.id);
  const enabledSet = new Set(compliance.enabled);
  const requiredSet = new Set(compliance.frameworks.filter((f) => f.isRequired).map((f) => f.framework));

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
    // Ignore missing config; suggestions are optional.
  }

  const hipaaSuggested = navSector === "healthcare";
  const pciSuggested = crownJewels.some((c) => c.id === "payments");

  const dashboards = new Map<string, Awaited<ReturnType<typeof computeComplianceFrameworkDashboard>>>();
  for (const fw of COMPLIANCE_FRAMEWORKS) {
    if (!enabledSet.has(fw)) continue;
    const dash = await computeComplianceFrameworkDashboard(db as any, { projectId: ctx.project.id, framework: fw });
    dashboards.set(fw, dash);
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Auto-generated audit readiness from live platform evidence (Navigator scenarios, actions, detections, and mappings).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/p/${p.projectSlug}/compliance/settings`}
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40"
          >
            Settings
          </Link>
          <Link
            href={`/p/${p.projectSlug}/risk/compliance`}
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40"
          >
            Mappings
          </Link>
        </div>
      </div>

      {!compliance.schemaReady ? (
        <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Compliance tables are missing. Run{" "}
          <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-950/30">pnpm db:migrate</code>.
        </div>
      ) : null}

      {(hipaaSuggested || pciSuggested) ? (
        <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detected requirements</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Based on Navigator setup. These frameworks are planned but not yet available as dashboards.
          </div>
          <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            {hipaaSuggested ? <div>HIPAA suggested (sector: healthcare)</div> : null}
            {pciSuggested ? <div>PCI-DSS suggested (crown jewel: payments)</div> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        {COMPLIANCE_FRAMEWORKS.map((fw) => {
          const enabled = enabledSet.has(fw);
          const required = requiredSet.has(fw);
          const dash = dashboards.get(fw);
          return (
            <Card key={fw} className="overflow-hidden">
              <CardHeader
                title={frameworkLabel(fw)}
                description={required ? "Required" : enabled ? "Enabled" : "Disabled"}
                dense
                border={false}
                right={
                  enabled ? (
                    <Link href={`/p/${p.projectSlug}/compliance/${fw}`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                      Open
                    </Link>
                  ) : (
                    <Link href={`/p/${p.projectSlug}/compliance/settings`} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                      Enable
                    </Link>
                  )
                }
              />
              <CardContent dense>
                {enabled && dash ? (
                  <div>
                    <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {nf(dash.coveragePct)}%
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      covered {nf(dash.coveredCount)} · partial {nf(dash.partialCount)} · gap {nf(dash.gapCount)}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    Enable this framework to start tracking coverage and gaps.
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="How it works" description="What counts as evidence." />
        <CardContent>
          <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
            <p>
              Coverage is evidence-based: a control is supported when mapped to validated Navigator scenarios (directly,
              via technique, or via mitigation), and the scenario shows implementation signals (actions and detections).
            </p>
            <p>
              Use <span className="font-medium text-zinc-900 dark:text-zinc-100">Mappings</span> to link scenarios, ATT&amp;CK techniques, or mitigations to
              controls.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
