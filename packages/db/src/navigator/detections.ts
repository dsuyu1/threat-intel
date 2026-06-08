import { and, eq } from "drizzle-orm";
import { kgEntities, navigatorDetectionFormatEnum, navigatorScenarios } from "../schema";

import type { Db } from "./engine";

export type NavigatorDetectionFormat = (typeof navigatorDetectionFormatEnum.enumValues)[number];

export function stripCodeFences(input: string) {
  const s = String(input ?? "").trim();
  const m = s.match(/^```[a-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? s).trim();
}

export type NavigatorDetectionPromptContext = {
  format: NavigatorDetectionFormat;
  sigmaRuleId: string;
  date: string;
  scenarioTitle: string;
  scenarioSummary: string | null;
  actorId: string;
  actorName: string | null;
  primaryTactic: string | null;
  techniqueId: string;
  techniqueName: string;
  techniqueDescription: string | null;
  evidence: Array<{ url: string; excerpt: string }>;
};

export function buildNavigatorDetectionPromptFromContext(ctx: NavigatorDetectionPromptContext) {
  const actorLabel = ctx.actorName ? `${ctx.actorName} (${ctx.actorId})` : ctx.actorId;
  const evidenceBlock = ctx.evidence.length
    ? ctx.evidence
        .slice(0, 4)
        .map((e, idx) => `- [${idx + 1}] ${e.url}\n  ${e.excerpt}`.trim())
        .join("\n")
    : "- (none)";

  const common = [
    "You are generating detection engineering output for a SOC analyst to paste into their SIEM.",
    "Prefer broadly-available telemetry and clearly mark placeholders like <INDEX>, <SOURCETYPE>, <TABLE>.",
    "If exact field names depend on data source, pick a reasonable default and keep the query adaptable.",
    "Do not include markdown fences; output only the detection content.",
    "",
    `Scenario: ${ctx.scenarioTitle}`,
    ctx.scenarioSummary ? `Scenario summary: ${ctx.scenarioSummary}` : "Scenario summary: (none)",
    `Actor: ${actorLabel}`,
    `Primary tactic: ${ctx.primaryTactic ?? "(unknown)"}`,
    "",
    `Technique: ${ctx.techniqueName} (${ctx.techniqueId})`,
    ctx.techniqueDescription ? `Technique description: ${ctx.techniqueDescription}` : "Technique description: (none)",
    "",
    "Evidence excerpts:",
    evidenceBlock,
    "",
  ].join("\n");

  if (ctx.format === "sigma") {
    return [
      common,
      "Generate ONE Sigma rule YAML.",
      "Constraints:",
      "- Output raw YAML only.",
      "- Include: title, id, status, description, references, author, date, tags, logsource, detection, falsepositives, level.",
      "- Use id exactly as provided.",
      `- Set date to ${ctx.date}.`,
      "- Tags MUST include the MITRE technique id (e.g. attack.t1059 or attack.t1059.001) and the tactic if known.",
      "- Prefer Sysmon / Windows Security / generic process creation if unsure, but do not invent unsupported logs.",
      "",
      `Use this id: ${ctx.sigmaRuleId}`,
    ].join("\n");
  }

  if (ctx.format === "kql") {
    return [
      common,
      "Generate a Microsoft Sentinel KQL query.",
      "Constraints:",
      "- Output raw KQL only.",
      "- Include a short comment header (//) describing required tables/data sources and tuning knobs.",
      "- Prefer common tables like DeviceProcessEvents, DeviceNetworkEvents, SecurityEvent, SigninLogs when relevant.",
      "- Use let statements for time window and optional allow/deny lists.",
    ].join("\n");
  }

  return [
    common,
    "Generate a Splunk SPL query.",
    "Constraints:",
    "- Output raw SPL only (no markdown, no prose).",
    "- Include placeholders for index/sourcetype if unknown.",
    "- Prefer CIM-friendly fields when possible (e.g., process, parent_process, dest, user), but keep it generic.",
    "- Ensure the query is runnable (avoid unsupported comment syntax).",
  ].join("\n");
}

export async function loadNavigatorDetectionPromptContext(params: {
  db: Db;
  projectId: string;
  scenarioId: string;
  techniqueId: string;
  format: NavigatorDetectionFormat;
  sigmaRuleId: string;
  date: string;
}): Promise<Omit<NavigatorDetectionPromptContext, "format" | "sigmaRuleId" | "date">> {
  const [scenario] = await params.db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      primaryTactic: navigatorScenarios.primaryTactic,
      evidenceJson: navigatorScenarios.evidenceJson,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, params.scenarioId), eq(navigatorScenarios.projectId, params.projectId)))
    .limit(1);

  if (!scenario) throw new Error("Scenario not found");

  const [technique] = await params.db
    .select({
      name: kgEntities.name,
      description: kgEntities.description,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "technique"), eq(kgEntities.entityId, params.techniqueId)))
    .limit(1);

  const evidenceItems = ((scenario.evidenceJson as any)?.items ?? []) as Array<{
    excerpt?: string;
    url?: string;
    confidence?: number;
  }>;

  const evidence = evidenceItems
    .filter((e) => e?.url && e?.excerpt)
    .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
    .slice(0, 4)
    .map((e) => ({
      url: String(e.url),
      excerpt: String(e.excerpt).slice(0, 600),
    }));

  const techniqueName = String(technique?.name ?? params.techniqueId);
  const techniqueDescription = technique?.description ?? null;

  return {
    scenarioTitle: String(scenario.title),
    scenarioSummary: scenario.summary ?? null,
    actorId: String(scenario.actorId),
    actorName: scenario.actorName ?? null,
    primaryTactic: scenario.primaryTactic ?? null,
    techniqueId: params.techniqueId,
    techniqueName,
    techniqueDescription,
    evidence,
  };
}

export async function buildNavigatorDetectionPrompt(params: {
  db: Db;
  projectId: string;
  scenarioId: string;
  techniqueId: string;
  format: NavigatorDetectionFormat;
  sigmaRuleId: string;
  date: string;
}): Promise<{ prompt: string; techniqueName: string }> {
  const ctx = await loadNavigatorDetectionPromptContext(params);
  const prompt = buildNavigatorDetectionPromptFromContext({
    ...ctx,
    format: params.format,
    sigmaRuleId: params.sigmaRuleId,
    date: params.date,
  });
  return { prompt, techniqueName: ctx.techniqueName };
}
