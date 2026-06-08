export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@ti/db";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { CsvExportButton } from "../../../../../../components/ui/CsvExportButton";
import { JsonExportButton } from "../../../../../../components/ui/JsonExportButton";
import { ComplianceControlsTable } from "../../../../../../components/compliance/ComplianceControlsTable";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";
import {
  computeComplianceFrameworkDashboard,
  frameworkLabel,
  getComplianceSettings,
  isComplianceFramework,
} from "../../../../../../lib/compliance";

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function ComplianceFrameworkPage({
  params,
}: {
  params: Promise<{ projectSlug: string; framework: string }>;
}) {
  const p = await params;
  if (!isComplianceFramework(p.framework)) notFound();

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

  const framework = p.framework;
  const label = frameworkLabel(framework);
  const compliance = await getComplianceSettings(db as any, ctx.project.id);
  const enabled = compliance.enabled.includes(framework);
  const dash = await computeComplianceFrameworkDashboard(db as any, { projectId: ctx.project.id, framework });

  const controlsCsvRows = dash.controls.map((c) => ({
    framework,
    controlId: c.controlId,
    title: c.title ?? "",
    status: c.status,
    bestCoveragePct: c.bestCoveragePct,
    maxResidual: c.maxResidual,
    evidenceScenarioCount: c.evidenceScenarioCount,
    topScenarioIds: c.topScenarios.map((s) => s.id).join(";"),
  }));

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}/compliance`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Compliance
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`/p/${p.projectSlug}/compliance/settings`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Settings
          </Link>
          <Link
            href={`/p/${p.projectSlug}/risk/compliance`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Mappings
          </Link>
        </div>
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{label}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Coverage and gaps derived from live evidence signals. Export outputs for audit readiness.
        </p>
      </div>

      {!enabled ? (
        <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
          This framework is currently disabled for this project. Enable it in{" "}
          <Link href={`/p/${p.projectSlug}/compliance/settings`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Compliance settings
          </Link>
          .
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader title="Coverage" description="Weighted score" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(dash.coveragePct)}%</div>
            <div className="mt-2 text-xs text-zinc-500">{dash.hasControlCatalog ? "Catalog-backed" : "Derived from mappings"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Covered" description="Controls" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(dash.coveredCount)}</div>
            <div className="mt-2 text-xs text-zinc-500">of {nf(dash.controlsTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Partial" description="Controls" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(dash.partialCount)}</div>
            <div className="mt-2 text-xs text-zinc-500">needs action / detection</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Gaps" description="Controls" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(dash.gapCount)}</div>
            <div className="mt-2 text-xs text-zinc-500">no mapped evidence</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Highest compliance risk (mapped)"
          description="Top residual scenarios that affect this framework."
          right={
            <CsvExportButton
              filename={`compliance_${framework}_top_risk_mapped.csv`}
              rows={dash.topMappedScenarios.map((s) => ({
                scenarioId: s.id,
                title: s.title,
                inherent: s.inherent,
                residual: s.residual,
                coveragePct: s.coveragePct,
                actionsDone: s.actionsDone,
                actionsTotal: s.actionsTotal,
                detectionsTotal: s.detectionsTotal,
                computedAt: s.computedAt ? s.computedAt.toISOString() : "",
              }))}
              columns={[
                { header: "scenarioId", key: "scenarioId" },
                { header: "title", key: "title" },
                { header: "inherent", key: "inherent" },
                { header: "residual", key: "residual" },
                { header: "coveragePct", key: "coveragePct" },
                { header: "actionsDone", key: "actionsDone" },
                { header: "actionsTotal", key: "actionsTotal" },
                { header: "detectionsTotal", key: "detectionsTotal" },
                { header: "computedAt", key: "computedAt" },
              ]}
              label="Export CSV"
            />
          }
        />
        <CardContent>
          {dash.topMappedScenarios.length ? (
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {dash.topMappedScenarios.slice(0, 15).map((s) => (
                <Link
                  key={s.id}
                  href={`/p/${p.projectSlug}/risk/${s.id}`}
                  className="block py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{s.title || s.id}</div>
                      <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                        coverage {nf(s.coveragePct)}% · actions {nf(s.actionsDone)}/{nf(s.actionsTotal)} · detections {nf(s.detectionsTotal)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{nf(s.residual)}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">residual</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No mapped scenarios yet. Add mappings from <Link className="text-indigo-600 dark:text-indigo-400 hover:underline" href={`/p/${p.projectSlug}/risk/compliance`}>Mappings</Link>{" "}
              or from any risk entry via “Compliance quick add”.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Highest compliance risk (unmapped)" description="Validated scenarios not mapped to this framework yet." />
        <CardContent>
          {dash.topUnmappedScenarios.length ? (
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              {dash.topUnmappedScenarios.slice(0, 12).map((s) => (
                <Link
                  key={s.id}
                  href={`/p/${p.projectSlug}/risk/${s.id}`}
                  className="block py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{s.title || s.id}</div>
                      <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                        residual {nf(s.residual)} · coverage {nf(s.coveragePct)}%
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Map</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No validated scenarios available.</div>
          )}
          <div className="mt-3 text-xs text-zinc-500">
            Tip: open a scenario and use “Compliance quick add” to link it to controls for this framework.
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Controls export"
          description="Download control-level status for auditors."
          right={
            <div className="flex items-center gap-2">
              <JsonExportButton
                url={`/api/compliance/${framework}`}
                filename={`compliance_${framework}_dashboard.json`}
                projectSlug={p.projectSlug}
                label="Export JSON"
              />
              <CsvExportButton
                filename={`compliance_${framework}_controls.csv`}
                rows={controlsCsvRows}
                columns={[
                  { header: "framework", key: "framework" },
                  { header: "controlId", key: "controlId" },
                  { header: "title", key: "title" },
                  { header: "status", key: "status" },
                  { header: "bestCoveragePct", key: "bestCoveragePct" },
                  { header: "maxResidual", key: "maxResidual" },
                  { header: "evidenceScenarioCount", key: "evidenceScenarioCount" },
                  { header: "topScenarioIds", key: "topScenarioIds" },
                ]}
                label="Export CSV"
              />
            </div>
          }
        />
        <CardContent>
          <ComplianceControlsTable projectSlug={p.projectSlug} framework={framework} controls={dash.controls} />
        </CardContent>
      </Card>
    </div>
  );
}
