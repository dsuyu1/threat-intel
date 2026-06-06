export const runtime = "edge";
export const dynamic = "force-dynamic";

import type { ComponentType } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/Card";
import { FileText, GitBranch, Network, Rss, Search, Terminal } from "lucide-react";

const CARDS: Array<{
  href: string;
  title: string;
  description: string;
  icon: "query" | "findings" | "sources" | "documents" | "entities" | "relations";
}> = [
  {
    href: "/data/query",
    title: "Query (KQL)",
    description: "Run Kusto-style queries across Findings + the knowledge graph.",
    icon: "query",
  },
  {
    href: "/data/findings",
    title: "Findings",
    description: "CVE/attack/TTP/exploit/malware output from agents.",
    icon: "findings",
  },
  {
    href: "/data/sources",
    title: "Sources",
    description: "RSS + STIX feeds, enablement, reliability, and health.",
    icon: "sources",
  },
  {
    href: "/data/documents",
    title: "Documents",
    description: "Fetched pages + status; the raw material for extraction.",
    icon: "documents",
  },
  {
    href: "/data/kg-entities",
    title: "KG entities",
    description: "Knowledge graph nodes: actors, CVEs, techniques, etc.",
    icon: "entities",
  },
  {
    href: "/data/kg-relations",
    title: "KG relations",
    description: "Evidence-weighted links between entities in the graph.",
    icon: "relations",
  },
];

const ICONS = {
  query: Terminal,
  findings: Search,
  sources: Rss,
  documents: FileText,
  entities: Network,
  relations: GitBranch,
} satisfies Record<(typeof CARDS)[number]["icon"], ComponentType<{ className?: string }>>;

export default function DataExplorerPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Data explorer
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Browse the backend database as sortable, queryable tables.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {CARDS.map((c) => {
          const Icon = ICONS[c.icon];
          return (
          <a
            key={c.href}
            href={c.href}
            className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-zinc-400/60 dark:focus:ring-zinc-500/60"
          >
            <Card className="h-full hover:bg-white/80 dark:hover:bg-black/35 transition-colors">
              <CardHeader
                title={
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
                    <span className="truncate">{c.title}</span>
                  </div>
                }
                description={c.description}
              />
              <CardContent>
                <span className="text-sm text-blue-600 dark:text-blue-400">
                  Open table →
                </span>
              </CardContent>
            </Card>
          </a>
          );
        })}
      </div>
    </div>
  );
}
