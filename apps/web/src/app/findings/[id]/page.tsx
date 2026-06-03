export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, findings } from "@ti/db";
import { eq } from "drizzle-orm";

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

  const tags = parseTags(finding.tags);

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10 space-y-6">
      <header className="space-y-2">
        <Link
          href="/findings"
          className="text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          â† Back to findings
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">{finding.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="font-mono">{finding.agent}</span>
          {finding.cveId && <span className="font-mono">{finding.cveId}</span>}
          {finding.severity && <span className="font-mono">{finding.severity}</span>}
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

      {finding.summary && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Summary</h2>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {finding.summary}
          </p>
        </section>
      )}

      {(finding.cvssScore || finding.cvssVector) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Scoring</h2>
          <div className="text-sm text-zinc-300 space-y-1">
            {finding.cvssScore && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 text-xs font-mono">CVSS</span>
                <span className="font-mono">{parseFloat(finding.cvssScore).toFixed(1)}</span>
              </div>
            )}
            {finding.cvssVector && (
              <div className="text-xs font-mono text-zinc-400 break-all">
                {finding.cvssVector}
              </div>
            )}
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Tags</h2>
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

      {(finding.sourceUrl || finding.pocUrl) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Links</h2>
          <div className="flex flex-col gap-2 text-sm">
            {finding.sourceUrl && (
              <a
                href={finding.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-400 transition-colors break-all"
              >
                Source â†—
              </a>
            )}
            {finding.pocUrl && (
              <a
                href={finding.pocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-400 transition-colors break-all"
              >
                PoC â†—
              </a>
            )}
          </div>
        </section>
      )}

      {finding.rawData && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Raw</h2>
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
