export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { PlaybookGenerateForm } from "../../../../../../components/playbooks/PlaybookGenerateForm";
import { getFindingContext, getScenarioContext, inferIncidentType } from "../../../../../../lib/playbooks/server";
import type { PlaybookIncidentType, PlaybookSourceKind } from "../../../../../../lib/playbooks/types";
import { getViewerContext } from "../../../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function normalizeSourceKind(value: unknown): PlaybookSourceKind {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "navigator_scenario" || v === "finding") return v;
  return "manual";
}

function normalizeIncidentType(value: unknown): PlaybookIncidentType | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const allowed: PlaybookIncidentType[] = [
    "vulnerability_exploitation",
    "credential_compromise",
    "ransomware",
    "supply_chain",
    "lateral_movement",
    "data_exfiltration",
  ];
  return (allowed as readonly string[]).includes(v) ? (v as PlaybookIncidentType) : null;
}

export default async function NewPlaybookPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const p = await params;
  const sp = await searchParams;

  const sourceKind = normalizeSourceKind(pickOne(sp.sourceKind));
  const sourceId = String(pickOne(sp.sourceId) ?? "").trim();
  const requestedIncidentType = normalizeIncidentType(pickOne(sp.incidentType));
  const requestedTitle = String(pickOne(sp.title) ?? "").trim();

  const ctx = await getViewerContext({ projectSlug: p.projectSlug });

  const scenario =
    sourceKind === "navigator_scenario" && sourceId
      ? await getScenarioContext({ scenarioId: sourceId, projectId: ctx.project.id })
      : null;
  const finding = sourceKind === "finding" && sourceId ? await getFindingContext({ findingId: sourceId }) : null;

  const inferredIncidentType = inferIncidentType({
    requested: requestedIncidentType,
    sourceKind,
    scenario,
    finding,
  });

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <Link href={`/p/${p.projectSlug}/playbooks`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to playbooks
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">New playbook</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Generate a draft incident response playbook with tool-aware steps for your current project.
        </p>
      </header>

      {scenario ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Source: Navigator scenario</div>
          <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{scenario.title}</div>
          <div className="mt-1 text-xs text-zinc-500">
            Actor: {scenario.actorName ?? scenario.actorId} · Tactic: {scenario.primaryTactic ?? "—"} · Type: {scenario.scenarioType}
          </div>
        </div>
      ) : null}

      {finding ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Source: Finding</div>
          <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{finding.title}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {finding.cveId ? `CVE: ${finding.cveId} · ` : ""}Severity: {finding.severity ?? "—"}
          </div>
        </div>
      ) : null}

      <PlaybookGenerateForm
        projectSlug={p.projectSlug}
        initial={{
          sourceKind,
          sourceId: sourceId || undefined,
          incidentType: inferredIncidentType,
          title: requestedTitle || undefined,
        }}
      />
    </div>
  );
}

