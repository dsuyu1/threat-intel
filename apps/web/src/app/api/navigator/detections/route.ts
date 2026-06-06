export const runtime = "edge";

import { getDb, kgEntities, navigatorDetections, navigatorScenarios } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { getAiProvider, getChatModel, generateText } from "../../../../lib/ai";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

type DetectionFormat = "sigma" | "kql" | "spl";

const FORMATS: DetectionFormat[] = ["sigma", "kql", "spl"];

function normalizeFormat(value: unknown): DetectionFormat | null {
  const v = String(value ?? "").trim().toLowerCase();
  return (FORMATS as readonly string[]).includes(v) ? (v as DetectionFormat) : null;
}

function stripCodeFences(input: string) {
  const s = String(input ?? "").trim();
  const m = s.match(/^```[a-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? s).trim();
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  const msg = String(anyErr?.message ?? err ?? "Unknown error");
  // Redact any accidentally surfaced API keys.
  return msg.replace(/sk-[a-z0-9]{20,}/gi, "sk-***");
}

function isMissingNavigatorDetectionsTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "");
  const msg = String(anyErr?.message ?? err ?? "");
  return code === "42P01" || msg.includes('navigator_detections') || msg.includes('relation "navigator_detections"');
}

function buildPrompt(params: {
  format: DetectionFormat;
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
}) {
  const actorLabel = params.actorName ? `${params.actorName} (${params.actorId})` : params.actorId;
  const evidenceBlock = params.evidence.length
    ? params.evidence
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
    `Scenario: ${params.scenarioTitle}`,
    params.scenarioSummary ? `Scenario summary: ${params.scenarioSummary}` : "Scenario summary: (none)",
    `Actor: ${actorLabel}`,
    `Primary tactic: ${params.primaryTactic ?? "(unknown)"}`,
    "",
    `Technique: ${params.techniqueName} (${params.techniqueId})`,
    params.techniqueDescription ? `Technique description: ${params.techniqueDescription}` : "Technique description: (none)",
    "",
    "Evidence excerpts:",
    evidenceBlock,
    "",
  ].join("\n");

  if (params.format === "sigma") {
    return [
      common,
      "Generate ONE Sigma rule YAML.",
      "Constraints:",
      "- Output raw YAML only.",
      "- Include: title, id, status, description, references, author, date, tags, logsource, detection, falsepositives, level.",
      "- Use id exactly as provided.",
      `- Set date to ${params.date}.`,
      "- Tags MUST include the MITRE technique id (e.g. attack.t1059 or attack.t1059.001) and the tactic if known.",
      "- Prefer Sysmon / Windows Security / generic process creation if unsure, but do not invent unsupported logs.",
      "",
      `Use this id: ${params.sigmaRuleId}`,
    ].join("\n");
  }

  if (params.format === "kql") {
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

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const url = new URL(req.url);
  const scenarioId = String(url.searchParams.get("scenarioId") ?? "");
  const techniqueId = String(url.searchParams.get("techniqueId") ?? "");
  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });

  try {
    const rows = await db
      .select({
        format: navigatorDetections.format,
        content: navigatorDetections.content,
        updatedAt: navigatorDetections.updatedAt,
        model: navigatorDetections.model,
      })
      .from(navigatorDetections)
      .where(
        and(
          eq(navigatorDetections.projectId, ctx.project.id),
          eq(navigatorDetections.scenarioId, scenarioId),
          eq(navigatorDetections.techniqueId, techniqueId)
        )
      )
      .orderBy(desc(navigatorDetections.updatedAt));

    return json({ detections: rows });
  } catch (err) {
    if (isMissingNavigatorDetectionsTable(err)) {
      return json({
        detections: [],
        warning: "navigator_detections table is missing; run pnpm --filter @ti/db db:migrate to enable caching.",
      });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const scenarioId = String(body?.scenarioId ?? "");
  const techniqueId = String(body?.techniqueId ?? "");
  const format = normalizeFormat(body?.format);
  const regenerate = Boolean(body?.regenerate);

  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });
  if (!format) return json({ error: `format must be one of: ${FORMATS.join(", ")}` }, { status: 400 });

  const [scenario] = await db
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
    .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
    .limit(1);

  if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });

  const [technique] = await db
    .select({
      name: kgEntities.name,
      description: kgEntities.description,
    })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "technique"), eq(kgEntities.entityId, techniqueId)))
    .limit(1);

  const techniqueName = String(technique?.name ?? body?.techniqueName ?? techniqueId);
  const techniqueDescription = technique?.description ?? null;

  // Best-effort caching (feature still works without migrations).
  if (!regenerate) {
    try {
      const [cached] = await db
        .select({
          content: navigatorDetections.content,
          updatedAt: navigatorDetections.updatedAt,
          model: navigatorDetections.model,
        })
      .from(navigatorDetections)
      .where(
        and(
            eq(navigatorDetections.projectId, ctx.project.id),
            eq(navigatorDetections.scenarioId, scenarioId),
            eq(navigatorDetections.techniqueId, techniqueId),
            eq(navigatorDetections.format, format)
          )
        )
        .limit(1);

      if (cached?.content) {
        return json({
          ok: true,
          cached: true,
          provider: getAiProvider(),
          model: cached.model ?? null,
          format,
          techniqueId,
          techniqueName,
          content: cached.content,
          updatedAt: cached.updatedAt,
        });
      }
    } catch (err) {
      if (!isMissingNavigatorDetectionsTable(err)) throw err;
    }
  }

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

  const sigmaRuleId = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);

  const prompt = buildPrompt({
    format,
    sigmaRuleId,
    date,
    scenarioTitle: String(scenario.title),
    scenarioSummary: scenario.summary ?? null,
    actorId: String(scenario.actorId),
    actorName: scenario.actorName ?? null,
    primaryTactic: scenario.primaryTactic ?? null,
    techniqueId,
    techniqueName,
    techniqueDescription,
    evidence,
  });

  let content = "";
  try {
    content = await generateText({ prompt, temperature: 0.15, maxTokens: 1100 });
    content = stripCodeFences(content);
  } catch (err) {
    const msg = safeErrorMessage(err);
    const status = /OPENAI_API_KEY|GEMINI_API_KEY/i.test(msg) ? 400 : 500;
    return json({ error: msg }, { status });
  }

  const model = getChatModel();
  const provider = getAiProvider();

  let persisted = false;
  let updatedAt: string | null = null;

  try {
    const now = new Date();
    const [row] = await db
      .insert(navigatorDetections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        scenarioId: scenario.id,
        techniqueId,
        techniqueName,
        format,
        content,
        model,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          navigatorDetections.projectId,
          navigatorDetections.scenarioId,
          navigatorDetections.techniqueId,
          navigatorDetections.format,
        ],
        set: {
          userId: ctx.user.id,
          techniqueName,
          content,
          model,
          updatedAt: now,
        },
      })
      .returning({ updatedAt: navigatorDetections.updatedAt });

    persisted = true;
    updatedAt = row?.updatedAt ? new Date(row.updatedAt).toISOString() : null;
  } catch (err) {
    if (!isMissingNavigatorDetectionsTable(err)) throw err;
  }

  return json({
    ok: true,
    cached: false,
    persisted,
    provider,
    model,
    format,
    techniqueId,
    techniqueName,
    content,
    updatedAt,
  });
}
