type EvidenceItem = {
  url: string;
  excerpt: string;
  publishedAt: string | null;
  confidence: number;
};

export function EvidenceDetails({
  evidence,
  label = "Why?",
}: {
  evidence: EvidenceItem[];
  label?: string;
}) {
  if (!evidence.length) return null;
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer select-none text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors">
        {label}
      </summary>
      <div className="mt-2 space-y-2">
        {evidence.map((e, idx) => (
          <div
            key={`${e.url}-${idx}`}
            className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
          >
            <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500">
              <span className="tabular-nums">
                {e.publishedAt ? new Date(e.publishedAt).toLocaleDateString() : "Unknown date"}
              </span>
              <span className="tabular-nums">
                confidence {Math.round((e.confidence ?? 0) * 100)}%
              </span>
            </div>
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
              “{e.excerpt}”
            </p>
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-blue-500 hover:text-blue-400 transition-colors break-all"
            >
              {e.url}
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}
