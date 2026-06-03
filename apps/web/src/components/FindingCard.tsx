import type { Finding } from "@ti/db";
import { CvssGauge } from "./CvssGauge";

interface Props {
  finding: Finding;
  teaser?: boolean; // true = paywall-blurred version on homepage
}

const AGENT_LABELS: Record<string, string> = {
  vuln: "CVE",
  attack: "Attack",
  ttp: "TTP",
  exploit: "Exploit",
  malware: "Malware",
};

const AGENT_COLORS: Record<string, string> = {
  vuln: "bg-blue-900/50 text-blue-300 border-blue-800",
  attack: "bg-red-900/50 text-red-300 border-red-800",
  ttp: "bg-purple-900/50 text-purple-300 border-purple-800",
  exploit: "bg-orange-900/50 text-orange-300 border-orange-800",
  malware: "bg-yellow-900/50 text-yellow-300 border-yellow-800",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
  info: "bg-gray-500",
};

export function FindingCard({ finding, teaser = false }: Props) {
  const agentLabel = AGENT_LABELS[finding.agent] ?? finding.agent;
  const agentColor =
    AGENT_COLORS[finding.agent] ?? "bg-gray-800 text-gray-400 border-gray-700";
  const severityDot = finding.severity
    ? SEVERITY_DOT[finding.severity] ?? "bg-gray-500"
    : null;

  const tags: string[] = (() => {
    try {
      return finding.tags ? JSON.parse(finding.tags) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-4">
        {/* CVSS gauge (only for vuln/exploit with a score) */}
        {finding.cvssScore && (
          <div className="shrink-0 hidden sm:block">
            <CvssGauge score={parseFloat(finding.cvssScore)} size={100} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded border ${agentColor}`}
            >
              {agentLabel}
            </span>

            {finding.cveId && (
              <span className="text-xs font-mono text-gray-400">
                {finding.cveId}
              </span>
            )}

            {severityDot && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className={`w-2 h-2 rounded-full ${severityDot}`} />
                {finding.severity}
              </span>
            )}

            {/* KEV badge */}
            {tags.includes("kev") && (
              <span className="text-xs bg-red-950 border border-red-800 text-red-400 px-2 py-0.5 rounded font-medium">
                ⚠ CISA KEV
              </span>
            )}

            <span className="ml-auto text-xs text-gray-600">
              {finding.publishedAt
                ? new Date(finding.publishedAt).toLocaleDateString()
                : ""}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2">
            {finding.title}
          </h3>

          {/* Summary — blurred for teaser */}
          {finding.summary && (
            <p
              className={`text-sm text-gray-400 line-clamp-3 ${
                teaser ? "blur-sm select-none pointer-events-none" : ""
              }`}
            >
              {finding.summary}
            </p>
          )}

          {/* Tags */}
          {tags.length > 0 && !tags.every((t) => t === "kev") && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags
                .filter((t) => t !== "kev" && t !== "actively-exploited")
                .slice(0, 4)
                .map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
            </div>
          )}

          {/* Source link */}
          {finding.sourceUrl && !teaser && (
            <a
              href={finding.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:text-blue-400 mt-2 inline-block transition-colors"
            >
              Source ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
