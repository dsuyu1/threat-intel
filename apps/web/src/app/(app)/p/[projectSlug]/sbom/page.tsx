export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, sboms } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { fingerprintDatabaseUrl, summarizeDatabaseUrl } from "../../../../../lib/db-fingerprint";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

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

export default async function SbomPage({
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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">SBOM</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">SBOM correlation is available on Pro.</p>
      </div>
    );
  }

  let uploads: Array<{
    id: string;
    name: string;
    format: string;
    componentCount: number | null;
    vulnerableComponentCount: number | null;
    matchedCveCount: number | null;
    createdAt: Date;
  }> = [];

  try {
    uploads = await db
      .select({
        id: sboms.id,
        name: sboms.name,
        format: sboms.format,
        componentCount: sboms.componentCount,
        vulnerableComponentCount: sboms.vulnerableComponentCount,
        matchedCveCount: sboms.matchedCveCount,
        createdAt: sboms.createdAt,
      })
      .from(sboms)
      .where(eq(sboms.projectId, ctx.project.id))
      .orderBy(desc(sboms.createdAt))
      .limit(50);
  } catch (err) {
    if (isMissingTable(err)) {
      const dbFingerprint = fingerprintDatabaseUrl(process.env.DATABASE_URL);
      const dbSummary = summarizeDatabaseUrl(process.env.DATABASE_URL);
      const showDbSummary = process.env.NODE_ENV !== "production";

      return (
        <div className="mx-auto max-w-[1100px] px-8 py-10">
          <Card>
            <CardHeader
              title="Database not migrated"
              description="The SBOM tables don't exist in your current DATABASE_URL."
            />
            <CardContent>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>Run migrations, then refresh this page:</p>
                <pre className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 p-3 text-xs overflow-auto">{`pnpm db:migrate`}</pre>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  DB fingerprint: <span className="font-mono">{dbFingerprint}</span>
                  {showDbSummary && (dbSummary.host || dbSummary.database) ? (
                    <>
                      {" "}
                      (<span className="font-mono">{dbSummary.host ?? "?"}</span> /{" "}
                      <span className="font-mono">{dbSummary.database ?? "?"}</span>)
                    </>
                  ) : null}
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  If you still see this error, compare the DB fingerprint above with the one printed by{" "}
                  <span className="font-mono">pnpm db:migrate</span>. If they differ, your dev server and your migration
                  command are pointing at different databases.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
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
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">SBOM</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload a CycloneDX or SPDX SBOM and correlate it against CVEs in the platform.
        </p>
      </header>

      <Card>
        <CardHeader title="Upload SBOM" description="JSON format recommended (CycloneDX or SPDX)." />
        <CardContent>
          <form
            action={`/p/${p.projectSlug}/sbom/upload`}
            method="post"
            encType="multipart/form-data"
            className="flex flex-col gap-3"
          >
            <input
              type="file"
              name="file"
              accept="application/json,.json"
              className="block text-sm"
              required
            />
            <button className="w-fit rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95">
              Upload
            </button>
          </form>
          <div className="mt-3 text-xs text-zinc-500">
            Tip: CycloneDX SBOMs that include a <code>vulnerabilities</code> section can be correlated down to affected
            components.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Uploads" description="Most recent SBOM uploads for this project." />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="text-left font-medium py-2 pr-4">Name</th>
                  <th className="text-left font-medium py-2 pr-4">Format</th>
                  <th className="text-right font-medium py-2 pr-4">Components</th>
                  <th className="text-right font-medium py-2 pr-4">Vulnerable</th>
                  <th className="text-right font-medium py-2 pr-4">Active CVEs</th>
                  <th className="text-left font-medium py-2 pr-4">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                {uploads.length ? (
                  uploads.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/p/${p.projectSlug}/sbom/${r.id}`}
                          className="text-zinc-900 dark:text-zinc-100 hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{r.format}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{nf(Number(r.componentCount ?? 0))}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{nf(Number(r.vulnerableComponentCount ?? 0))}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{nf(Number(r.matchedCveCount ?? 0))}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-600 dark:text-zinc-400">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-sm text-zinc-600 dark:text-zinc-400">
                      No SBOMs uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
