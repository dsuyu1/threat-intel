export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, findings, projectFindingStackMatches } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { CvssVolumeBar } from "../../../../components/CvssVolumeBar";
import { CopyToClipboardButton } from "../../../../components/ui/CopyToClipboardButton";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";
import { fixText } from "../../../../lib/text";
import { getProjectCveExposure } from "../../../../lib/vuln-scanners/exposure";

function isMissingColumn(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  if (code === "42703") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('column "') && msg.includes("does not exist");
}

async function getFindingById(id: string) {
  const db = getDb();
  try {
    const [row] = await db
      .select({
        id: findings.id,
        agent: findings.agent,
        title: findings.title,
        summary: findings.summary,
        severity: findings.severity,
        cvssScore: findings.cvssScore,
        cvssVector: findings.cvssVector,
        epssScore: findings.epssScore,
        epssPercentile: findings.epssPercentile,
        epssUpdatedAt: findings.epssUpdatedAt,
        cveId: findings.cveId,
        tags: findings.tags,
        sourceUrl: findings.sourceUrl,
        pocUrl: findings.pocUrl,
        publishedAt: findings.publishedAt,
        createdAt: findings.createdAt,
        rawData: findings.rawData,
      })
      .from(findings)
      .where(eq(findings.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    // If the DB is behind migrations, avoid selecting newer columns.
    if (!isMissingColumn(err)) throw err;
    const [row] = await db
      .select({
        id: findings.id,
        agent: findings.agent,
        title: findings.title,
        summary: findings.summary,
        severity: findings.severity,
        cvssScore: findings.cvssScore,
        cvssVector: findings.cvssVector,
        cveId: findings.cveId,
        tags: findings.tags,
        sourceUrl: findings.sourceUrl,
        pocUrl: findings.pocUrl,
        publishedAt: findings.publishedAt,
        createdAt: findings.createdAt,
        rawData: findings.rawData,
      })
      .from(findings)
      .where(eq(findings.id, id))
      .limit(1);
    return row ?? null;
  }
}

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? JSON.parse(tagsJson) : [];
  } catch {
    return [];
  }
}

function parseEpssScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

export default async function FindingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const finding = await getFindingById(id);
  if (!finding) notFound();

  const ctx = await getViewerContext();
  const proAccess = hasNavigatorAccess({ tier: ctx.user.tier });
  const tags = parseTags(finding.tags);
  const primarySourceUrl = finding.pocUrl ?? finding.sourceUrl;

  const exposure = proAccess && finding.cveId
    ? await getProjectCveExposure({ projectId: ctx.project.id, cveId: finding.cveId })
    : null;

  const stackMatches = await (async () => {
    try {
      return await getDb()
        .select({
          technology: projectFindingStackMatches.technology,
          versionRange: projectFindingStackMatches.versionRange,
        })
        .from(projectFindingStackMatches)
        .where(
          and(
            eq(projectFindingStackMatches.projectId, ctx.project.id),
            eq(projectFindingStackMatches.findingId, finding.id)
          )
        )
        .orderBy(desc(projectFindingStackMatches.createdAt))
        .limit(12);
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") return [];
      throw err;
    }
  })();

  const epssScore = parseEpssScore((finding as any).epssScore);
  const epssPercentile = parseEpssScore((finding as any).epssPercentile);
  const hasScoring = Boolean(finding.cvssScore || finding.cvssVector || epssScore != null || epssPercentile != null);

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10 space-y-6">
      <header className="space-y-2">
        <Link
          href="/findings"
          className="text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          ← Back to findings
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">{fixText(finding.title)}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="tracking-wide">{finding.agent}</span>
          {finding.cveId && <span className="tabular-nums tracking-wide">{finding.cveId}</span>}
          {finding.severity && (
            <span className="tabular-nums tracking-wide">{finding.severity}</span>
          )}
          {finding.publishedAt && (
            <span>
              {new Date(finding.publishedAt).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
              })}
            </span>
          )}
        </div>
      </header>

      {stackMatches.length ? (
        <section className="rounded-2xl border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 backdrop-blur p-5">
          <div className="text-xs uppercase tracking-wide text-amber-800 dark:text-amber-200/90">Your stack</div>
          {stackMatches.length === 1 ? (
            <div className="mt-2 text-sm text-amber-900 dark:text-amber-100">
              This finding affects{" "}
              <span className="font-medium">
                {stackMatches[0]!.technology}
                {stackMatches[0]!.versionRange ? ` ${stackMatches[0]!.versionRange}` : ""}
              </span>{" "}
              in your stack.
            </div>
          ) : (
            <div className="mt-2 text-sm text-amber-900 dark:text-amber-100">
              This finding affects these items in your stack:
              <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
                {stackMatches.map((m) => (
                  <li key={`${m.technology}::${m.versionRange ?? ""}`}>
                    <span className="font-medium">
                      {m.technology}
                      {m.versionRange ? ` ${m.versionRange}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      {proAccess && finding.cveId ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5 space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Exposure</div>
              <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                Scanner-confirmed affected hosts for <span className="font-mono">{finding.cveId}</span>.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/integrations/vuln-scanners`}
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
              >
              Manage scanners →
              </Link>
              <Link
                href={`/p/${ctx.project.slug}/exposure/${encodeURIComponent(finding.cveId)}`}
                className="h-8 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-xs font-medium hover:opacity-95"
              >
                View hosts
              </Link>
            </div>
          </div>

          {!exposure?.connection ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No scanner connection is configured for this project.
            </div>
          ) : !exposure.exposure ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              No exposure data cached yet. Trigger a sync from the connection page.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <div className="text-zinc-700 dark:text-zinc-300">
                  Affected hosts:{" "}
                  <span className="tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {exposure.exposure.affectedHostCount}
                  </span>
                </div>
                {exposure.exposure.lastSeenAtIso ? (
                  <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                    Last seen:{" "}
                    <span className="tabular-nums">
                      {new Date(exposure.exposure.lastSeenAtIso).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" })}
                    </span>
                  </div>
                ) : null}
                {exposure.connection?.lastSyncedAtIso ? (
                  <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                    Synced:{" "}
                    <span className="tabular-nums">
                      {new Date(exposure.connection.lastSyncedAtIso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ) : null}
              </div>

              {exposure.exposure.sampleHosts.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                      <tr>
                        <th className="text-left font-medium py-2 pr-4">Host</th>
                        <th className="text-left font-medium py-2 pr-4">IP</th>
                        <th className="text-left font-medium py-2">Last seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                      {exposure.exposure.sampleHosts.map((h, idx) => (
                        <tr key={`${h.hostname ?? "host"}:${h.ipv4 ?? "ip"}:${idx}`}>
                    <td className="py-2 pr-4 text-zinc-900 dark:text-zinc-100">{h.hostname ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">{h.ipv4 ?? "—"}</td>
                          <td className="py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No host samples available yet.</div>
              )}
            </div>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">UUID</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2.5 py-1.5 text-xs font-mono text-zinc-800 dark:text-zinc-100">
                {finding.id}
              </code>
            </div>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Use this UUID when generating playbooks (Source: Finding).
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CopyToClipboardButton text={finding.id} label="UUID" />
            <Link
              href={`/p/${ctx.project.slug}/playbooks/new?sourceKind=finding&sourceId=${finding.id}`}
              className="h-9 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 text-sm font-medium hover:opacity-95"
            >
              Create playbook
            </Link>
          </div>
        </div>
      </section>

      {finding.summary && (
        <section className="space-y-2">
          <h1 className="text-sm font-semibold text-zinc-200">Summary</h1>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {fixText(finding.summary)}
            </p>
        </section>
      )}

      {hasScoring && (
        <section className="space-y-3">
          <h1 className="text-sm font-semibold text-zinc-200">Scoring</h1>
          <div
            className={
              finding.cvssScore
                ? "grid gap-4 sm:grid-cols-[auto_1fr] items-start"
                : "space-y-2"
            }
          >
            {finding.cvssScore && (
              <div className="shrink-0">
                <CvssVolumeBar
                  score={parseFloat(finding.cvssScore)}
                  className="h-[140px] w-5"
                />
              </div>
            )}
            <div className="text-sm text-zinc-300 space-y-1">
              {finding.cvssScore && (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-xs">CVSS</span>
                  <span className="tabular-nums font-medium">
                    {parseFloat(finding.cvssScore).toFixed(1)}
                  </span>
                </div>
              )}
              {epssScore != null ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-xs">EPSS</span>
                  <span className="tabular-nums font-medium">{(epssScore * 100).toFixed(1)}%</span>
                  <span className="text-xs text-zinc-500">30-day exploitation probability</span>
                </div>
              ) : null}
              {epssPercentile != null ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>EPSS percentile</span>
                  <span className="tabular-nums">{(epssPercentile * 100).toFixed(1)}%</span>
                </div>
              ) : null}
              {finding.cvssVector && (
                <div className="text-xs text-zinc-400 break-all tabular-nums">
                  {finding.cvssVector}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section className="space-y-2">
          <h1 className="text-sm font-semibold text-zinc-200">Tags</h1>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-1 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {primarySourceUrl && (
        <section className="space-y-2">
          <h1 className="text-sm font-semibold text-zinc-200">Links</h1>
          <div className="flex flex-col gap-2 text-sm">
            {primarySourceUrl && (
              <a
                href={primarySourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-400 transition-colors break-all"
              >
                Source ↗
              </a>
            )}
            {false && (
              <a
                href={finding.pocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-400 transition-colors break-all"
              >
                PoC ↗
              </a>
            )}
          </div>
        </section>
      )}

      {finding.rawData && (
        <section className="space-y-2">
          <h1 className="text-sm font-semibold text-zinc-200">Raw</h1>
          <details className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <summary className="cursor-pointer text-sm text-zinc-400">
              Show raw source payload
            </summary>
            <pre className="mt-3 text-xs text-zinc-500 overflow-auto whitespace-pre-wrap break-words">
              {finding.rawData}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
