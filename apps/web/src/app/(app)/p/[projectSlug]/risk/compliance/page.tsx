export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { complianceMappings, getDb } from "@ti/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { CsvExportButton } from "../../../../../../components/ui/CsvExportButton";
import { ComplianceMappingEditor } from "../../../../../../components/risk/ComplianceMappingEditor";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function frameworkLabel(framework: string) {
  if (framework === "nist_csf_2") return "NIST CSF 2.0";
  if (framework === "cis_v8") return "CIS v8";
  if (framework === "iso_27001") return "ISO 27001";
  return framework;
}

function sourceLabel(kind: string, id: string) {
  const k = String(kind ?? "").trim();
  if (k === "scenario") return `Scenario · ${id}`;
  if (k === "technique") return `Technique · ${id}`;
  if (k === "mitigation") return `Mitigation · ${id}`;
  return `${k} · ${id}`;
}

export default async function RiskCompliancePage({
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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance mappings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Risk management is available on Pro.</p>
      </div>
    );
  }

  let tableMissing = false;
  let counts: Array<{ framework: string; count: number }> = [];
  let recent: Array<{
    id: string;
    framework: string;
    sourceKind: string;
    sourceId: string;
    controlId: string;
    controlTitle: string | null;
    updatedAt: Date | null;
  }> = [];

  try {
    const rows = await db
      .select({
        framework: complianceMappings.framework,
        count: sql<number>`count(*)`,
      })
      .from(complianceMappings)
      .where(eq(complianceMappings.projectId, ctx.project.id))
      .groupBy(complianceMappings.framework)
      .orderBy(asc(complianceMappings.framework))
      .limit(10);

    counts = rows.map((r) => ({ framework: String(r.framework), count: Number(r.count ?? 0) }));

    const recentRows = await db
      .select({
        id: complianceMappings.id,
        framework: complianceMappings.framework,
        sourceKind: complianceMappings.sourceKind,
        sourceId: complianceMappings.sourceId,
        controlId: complianceMappings.controlId,
        controlTitle: complianceMappings.controlTitle,
        updatedAt: complianceMappings.updatedAt,
      })
      .from(complianceMappings)
      .where(eq(complianceMappings.projectId, ctx.project.id))
      .orderBy(desc(complianceMappings.updatedAt))
      .limit(200);

    recent = recentRows.map((r) => ({
      id: r.id,
      framework: String(r.framework),
      sourceKind: String(r.sourceKind),
      sourceId: String(r.sourceId),
      controlId: String(r.controlId),
      controlTitle: r.controlTitle ? String(r.controlTitle) : null,
      updatedAt: r.updatedAt ?? null,
    }));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") tableMissing = true;
    else throw err;
  }

  const countBy = new Map(counts.map((c) => [c.framework, c.count] as const));

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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Compliance mappings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Map scenarios, ATT&CK techniques, or mitigations to NIST CSF 2.0, CIS v8, or ISO 27001 controls so risks can be
          reported in stakeholder and audit language.
        </p>
      </div>

      {tableMissing ? (
        <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Compliance tables are missing. Run{" "}
          <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-950/30">pnpm db:migrate</code>.
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader title="NIST CSF 2.0" description="Mappings" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(countBy.get("nist_csf_2") ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="CIS v8" description="Mappings" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(countBy.get("cis_v8") ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="ISO 27001" description="Mappings" dense border={false} />
          <CardContent dense>
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {nf(countBy.get("iso_27001") ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Recent mappings"
          description="Most recently updated control links."
          right={
            <CsvExportButton
              filename="compliance_mappings_recent.csv"
              rows={recent.map((r) => ({
                framework: r.framework,
                sourceKind: r.sourceKind,
                sourceId: r.sourceId,
                controlId: r.controlId,
                controlTitle: r.controlTitle ?? "",
                updatedAt: r.updatedAt ? r.updatedAt.toISOString() : "",
              }))}
              columns={[
                { header: "framework", key: "framework" },
                { header: "sourceKind", key: "sourceKind" },
                { header: "sourceId", key: "sourceId" },
                { header: "controlId", key: "controlId" },
                { header: "controlTitle", key: "controlTitle" },
                { header: "updatedAt", key: "updatedAt" },
              ]}
              label="Export CSV"
            />
          }
        />
        <CardContent>
          {recent.length ? (
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
              <div className="hidden md:grid grid-cols-12 gap-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                <div className="col-span-2">Framework</div>
                <div className="col-span-4">Source</div>
                <div className="col-span-5">Control</div>
                <div className="col-span-1 text-right">Updated</div>
              </div>
              {recent.map((r) => (
                <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 py-3">
                  <div className="md:col-span-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {frameworkLabel(r.framework)}
                  </div>
                  <div className="md:col-span-4 text-xs text-zinc-600 dark:text-zinc-400">
                    <div className="font-medium text-zinc-700 dark:text-zinc-300">
                      {sourceLabel(r.sourceKind, r.sourceId)}
                    </div>
                  </div>
                  <div className="md:col-span-5 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{r.controlId}</div>
                    {r.controlTitle ? (
                      <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 truncate">{r.controlTitle}</div>
                    ) : null}
                  </div>
                  <div className="md:col-span-1 text-xs text-zinc-500 md:text-right tabular-nums">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No mappings yet.</div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Add mappings" description="Quickly link items to controls." />
        <CardContent>
          <ComplianceMappingEditor projectSlug={p.projectSlug} />
        </CardContent>
      </Card>
    </div>
  );
}
