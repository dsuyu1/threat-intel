export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { findings, getDb, sboms } from "@ti/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { fingerprintDatabaseUrl, summarizeDatabaseUrl } from "../../../../../../lib/db-fingerprint";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { analyzeSbom } from "../../../../../../lib/sbom";
import { getViewerContext } from "../../../../../../lib/tenancy";

function nf(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  if (code === "42P01") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('relation "') && msg.includes("does not exist");
}

function severityFromCvss(score: number | null) {
  if (score == null || !Number.isFinite(score)) return "info";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

export default async function SbomDetailPage({
  params,
}: {
  params: Promise<{ projectSlug: string; sbomId: string }>;
}) {
  const p = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">SBOM</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">SBOM correlation is available on Pro.</p>
      </div>
    );
  }

  let row:
    | {
        id: string;
        name: string;
        format: string;
        sha256: string;
        document: any;
        componentCount: number | null;
        vulnerableComponentCount: number | null;
        matchedCveCount: number | null;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .select({
        id: sboms.id,
        name: sboms.name,
        format: sboms.format,
        sha256: sboms.sha256,
        document: sboms.document,
        componentCount: sboms.componentCount,
        vulnerableComponentCount: sboms.vulnerableComponentCount,
        matchedCveCount: sboms.matchedCveCount,
        createdAt: sboms.createdAt,
      })
      .from(sboms)
      .where(and(eq(sboms.id, p.sbomId), eq(sboms.projectId, ctx.project.id)))
      .limit(1);
  } catch (err) {
    if (isMissingTable(err)) {
      const dbFingerprint = fingerprintDatabaseUrl(process.env.DATABASE_URL);
      const dbSummary = summarizeDatabaseUrl(process.env.DATABASE_URL);
      const showDbSummary = process.env.NODE_ENV !== "production";

      return (
        <div className="max-w-[1600px] mx-auto px-8 py-12">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Database not migrated</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            The SBOM tables don&rsquo;t exist in your current DATABASE_URL. Run <span className="font-mono">pnpm db:migrate</span> and refresh.
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            DB fingerprint: <span className="font-mono">{dbFingerprint}</span>
            {showDbSummary && (dbSummary.host || dbSummary.database) ? (
              <>
                {" "}
                (<span className="font-mono">{dbSummary.host ?? "?"}</span> /{" "}
                <span className="font-mono">{dbSummary.database ?? "?"}</span>)
              </>
            ) : null}
          </p>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            If this persists after migrating, make sure <span className="font-mono">pnpm db:migrate</span> prints the
            same DB fingerprint.
          </p>
          <Link href={`/p/${p.projectSlug}/sbom`} className="mt-4 inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Back to SBOMs
          </Link>
        </div>
      );
    }
    throw err;
  }

  if (!row) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">SBOM not found</h1>
        <Link href={`/p/${p.projectSlug}/sbom`} className="mt-2 inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          Back to SBOMs
        </Link>
      </div>
    );
  }

  const analysis = analyzeSbom(row.document);

  const allCves = new Set<string>();
  for (const set of analysis.cvesByComponentRef.values()) for (const cve of set) allCves.add(cve);
  const cveIds = Array.from(allCves).slice(0, 2000);

  const cvssByCve = new Map<string, number | null>();
  if (cveIds.length) {
    const rows = await db
      .select({
        cveId: findings.cveId,
        cvss: sql<number | null>`max(${findings.cvssScore})`,
      })
      .from(findings)
      .where(and(inArray(findings.cveId, cveIds), sql`${findings.cveId} is not null`))
      .groupBy(findings.cveId)
      .orderBy(desc(sql`max(${findings.cvssScore})`))
      .limit(5000);
    for (const r of rows) {
      if (!r.cveId) continue;
      const n = r.cvss == null ? null : Number(r.cvss);
      cvssByCve.set(String(r.cveId), Number.isFinite(n as any) ? n : null);
    }
  }

  const vulnerable = analysis.components
    .map((c) => {
      const cves = analysis.cvesByComponentRef.get(c.ref) ?? new Set<string>();
      const active = Array.from(cves).filter((x) => cvssByCve.has(x));
      const bestCvss = active.reduce((best: number | null, id) => {
        const s = cvssByCve.get(id) ?? null;
        if (s == null) return best;
        return best == null ? s : Math.max(best, s);
      }, null);
      return {
        ...c,
        cves: Array.from(cves),
        activeCves: active,
        bestCvss,
        severity: severityFromCvss(bestCvss),
      };
    })
    .filter((c) => c.cves.length > 0)
    .sort((a, b) => b.activeCves.length - a.activeCves.length || (b.bestCvss ?? 0) - (a.bestCvss ?? 0));

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}/sbom`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← SBOMs
        </Link>
        <a
          href={`/p/${p.projectSlug}/sbom/${row.id}/download`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Download JSON
        </a>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{row.name}</h1>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {row.format} • {nf(Number(row.componentCount ?? analysis.components.length))} components •{" "}
          {nf(Number(row.vulnerableComponentCount ?? vulnerable.length))} vulnerable •{" "}
          {nf(Number(row.matchedCveCount ?? cvssByCve.size))} active CVEs
        </div>
        <div className="text-xs text-zinc-500">sha256: {row.sha256}</div>
      </header>

      {!analysis.cvesByComponentRef.size ? (
        <Card>
          <CardHeader title="No vulnerability section found" description="This SBOM doesn’t include component-to-CVE mappings." />
          <CardContent>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Upload a CycloneDX SBOM that includes a top-level <code>vulnerabilities</code> section to get per-component CVE correlation.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Vulnerable components" description="Components with mapped CVEs (and which of those CVEs are present in the platform)." />
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                  <tr>
                    <th className="text-left font-medium py-2 pr-4">Component</th>
                    <th className="text-left font-medium py-2 pr-4">Version</th>
                    <th className="text-left font-medium py-2 pr-4">PURL</th>
                    <th className="text-left font-medium py-2 pr-4">Severity</th>
                    <th className="text-right font-medium py-2 pr-4">Active CVEs</th>
                    <th className="text-left font-medium py-2 pr-4">Top CVEs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                  {vulnerable.map((c) => (
                    <tr key={c.ref}>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</div>
                        <div className="text-xs text-zinc-500 truncate max-w-[360px]">{c.ref}</div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{c.version ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400 max-w-[280px] truncate">{c.purl ?? "—"}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{c.severity}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{nf(c.activeCves.length)}</td>
                      <td className="py-3 pr-4 text-xs">
                        <div className="flex flex-wrap gap-2">
                          {c.activeCves.slice(0, 4).map((id) => (
                            <a
                              key={id}
                              href={`/data/findings?q=${encodeURIComponent(id)}`}
                              className="rounded border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                            >
                              {id}
                            </a>
                          ))}
                          {c.activeCves.length > 4 ? <span className="text-zinc-500">+{c.activeCves.length - 4} more</span> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
