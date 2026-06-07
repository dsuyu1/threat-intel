export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, findings } from "@ti/db";
import { eq } from "drizzle-orm";
import { CvssVolumeBar } from "../../../components/CvssVolumeBar";
import { CopyToClipboardButton } from "../../../components/ui/CopyToClipboardButton";
import { getViewerContext } from "../../../lib/tenancy";
import { fixText } from "../../../lib/text";

async function getFindingById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(findings)
    .where(eq(findings.id, id))
    .limit(1);
  return row ?? null;
}

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? JSON.parse(tagsJson) : [];
  } catch {
    return [];
  }
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
  const tags = parseTags(finding.tags);
  const primarySourceUrl = finding.pocUrl ?? finding.sourceUrl;

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

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Finding UUID</div>
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
            <CopyToClipboardButton text={finding.id} label="Finding UUID" />
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

      {(finding.cvssScore || finding.cvssVector) && (
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
