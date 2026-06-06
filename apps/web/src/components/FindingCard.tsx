import { CvssVolumeBar } from "./CvssVolumeBar";

export type FindingCardModel = {
  id: string;
  agent: string;
  title: string;
  summary: string | null;
  severity: string | null;
  cvssScore: string | null;
  cvssVector: string | null;
  cveId: string | null;
  tags: string[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  pocUrl: string | null;
  pocLevel: string | null;
  publishedAt: string | null;
  createdAt: string;
};

interface Props {
  finding: FindingCardModel;
  teaser?: boolean; // paywall-blurred version on homepage
  className?: string;
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

function parseCvss(score: string | null) {
  if (!score) return null;
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

function hasTag(tags: string[], t: string) {
  const needle = t.toLowerCase();
  return tags.some((x) => x.toLowerCase() === needle);
}

function hasPoc(f: FindingCardModel) {
  if (f.pocUrl) return true;
  return hasTag(f.tags, "githubpoc");
}

function fmtWhen(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export function FindingCard({ finding, teaser = false, className = "" }: Props) {
  const agentLabel = AGENT_LABELS[finding.agent] ?? finding.agent;
  const agentColor =
    AGENT_COLORS[finding.agent] ?? "bg-gray-800 text-gray-400 border-gray-700";

  const score = parseCvss(finding.cvssScore);
  const isKev = hasTag(finding.tags, "kev");
  const isExploited = hasTag(finding.tags, "actively-exploited") || isKev;

  return (
    <div
      className={[
        "bg-white dark:bg-[#141414] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors",
        className,
      ].join(" ")}
    >
      <div className="flex items-start gap-4">
        {(finding.agent === "vuln" || finding.agent === "exploit") && score != null ? (
          <div className="shrink-0 pt-0.5">
            <CvssVolumeBar score={score} className="h-[76px] w-4 sm:h-[100px]" />
          </div>
        ) : null}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${agentColor}`}>
              {agentLabel}
            </span>

            {score != null ? (
              <span className="text-xs text-gray-400 tabular-nums">
                {score.toFixed(1)}
              </span>
            ) : (
              <span className="text-xs text-gray-500 tabular-nums">Unscored</span>
            )}

            {isExploited ? (
              <span className="text-xs bg-fuchsia-950 border border-fuchsia-800 text-fuchsia-300 px-2 py-0.5 rounded font-medium">
                ⚡ Exploited
              </span>
            ) : null}

            {isKev ? (
              <span className="text-xs bg-red-950 border border-red-800 text-red-400 px-2 py-0.5 rounded font-medium">
                ⚠ CISA KEV
              </span>
            ) : null}

            {hasPoc(finding) ? (
              <span className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
                PoC
              </span>
            ) : null}

            <span className="ml-auto text-xs text-gray-600">
              {fmtWhen(finding.publishedAt ?? finding.createdAt)}
            </span>
          </div>

          <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2">{finding.title}</h3>

          {finding.summary ? (
            <p
              className={`text-sm text-gray-400 line-clamp-3 ${
                teaser ? "blur-sm select-none pointer-events-none" : ""
              }`}
            >
              {finding.summary}
            </p>
          ) : null}

          {finding.tags.length > 0 && !finding.tags.every((t) => t === "kev") ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {finding.tags
                .filter((t) => t !== "kev" && t !== "actively-exploited")
                .slice(0, 4)
                .map((tag) => (
                  <span key={tag} className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded">
                    {tag}
                  </span>
                ))}
            </div>
          ) : null}

          {!teaser ? (
            <div className="flex items-center gap-3 mt-2">
              {finding.sourceUrl ? (
                <a
                  href={finding.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  Source →
                </a>
              ) : null}
              {finding.pocUrl ? (
                <a
                  href={finding.pocUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  PoC →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
