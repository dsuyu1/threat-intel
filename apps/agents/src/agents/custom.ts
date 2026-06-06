import { getDb, agentOutputs, customAgents, findings, userStack } from "@ti/db";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { generateText, type AiOverrides } from "../lib/openai.js";
import { getUserAiOverrides } from "../lib/user-ai-keys.js";
import { finishRun, logRunEvent, startRun } from "../lib/agent-runs.js";

type FetchFindingsStep = {
  type: "fetch_findings";
  params?: {
    hoursBack?: number;
    agents?: string[];
    limit?: number;
  };
};

type GenerateReportStep = {
  type: "generate_report";
  params?: {
    prompt?: string;
    maxTokens?: number;
    temperature?: number;
  };
};

type CustomAgentDefinitionV1 = {
  version: 1;
  steps: Array<FetchFindingsStep | GenerateReportStep>;
};

function asNumber(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asString(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => !!s);
}

function normalizeDefinition(def: unknown): CustomAgentDefinitionV1 {
  const anyDef = def as any;
  const stepsRaw = Array.isArray(anyDef?.steps) ? anyDef.steps : [];
  const steps = stepsRaw
    .map((s: any) => {
      const type = String(s?.type ?? "");
      if (type === "fetch_findings") {
        return {
          type: "fetch_findings" as const,
          params: {
            hoursBack: asNumber(s?.params?.hoursBack, 24),
            agents: asStringArray(s?.params?.agents),
            limit: asNumber(s?.params?.limit, 20),
          },
        };
      }
      if (type === "generate_report") {
        return {
          type: "generate_report" as const,
          params: {
            prompt: asString(s?.params?.prompt, "Summarize what matters and why."),
            maxTokens: asNumber(s?.params?.maxTokens, 800),
            temperature: asNumber(s?.params?.temperature, 0.2),
          },
        };
      }
      return null;
    })
    .filter(Boolean) as CustomAgentDefinitionV1["steps"];

  return { version: 1, steps: steps.length ? steps : [{ type: "fetch_findings", params: { hoursBack: 24, limit: 20 } }, { type: "generate_report" }] };
}

function renderFindingsForPrompt(rows: Array<{ agent: string; title: string; cveId: string | null; sourceUrl: string | null; publishedAt: Date | null }>) {
  if (!rows.length) return "No matching findings found in the selected window.";
  return rows
    .map((r, i) => {
      const cve = r.cveId ? ` (${r.cveId})` : "";
      const url = r.sourceUrl ? ` — ${r.sourceUrl}` : "";
      const when = r.publishedAt ? ` — ${r.publishedAt.toISOString()}` : "";
      return `${i + 1}. [${r.agent}] ${r.title}${cve}${url}${when}`;
    })
    .join("\n");
}

export async function runCustomAgents() {
  const db = getDb();

  const agents = await db
    .select({
      id: customAgents.id,
      projectId: customAgents.projectId,
      userId: customAgents.userId,
      name: customAgents.name,
      enabled: customAgents.enabled,
      scheduleMinutes: customAgents.scheduleMinutes,
      definition: customAgents.definition,
      lastRunAt: customAgents.lastRunAt,
    })
    .from(customAgents)
    .where(eq(customAgents.enabled, true))
    .orderBy(desc(customAgents.updatedAt))
    .limit(50);

  const now = Date.now();
  const due = agents.filter((a) => {
    const everyMs = Math.max(5, Number(a.scheduleMinutes ?? 1440)) * 60 * 1000;
    if (!a.lastRunAt) return true;
    return now - new Date(a.lastRunAt as any).getTime() >= everyMs;
  });

  for (const a of due) {
    const run = await startRun({
      agentKey: "custom",
      kind: "custom",
      projectId: a.projectId,
      userId: a.userId,
      customAgentId: a.id,
    });

    await logRunEvent({ runId: run.id, message: `Custom agent: ${a.name}` });

    try {
      const definition = normalizeDefinition(a.definition);
      const ctx: { findings?: any[]; report?: string } = {};

      const { ai, error: aiError } = await getUserAiOverrides({ userId: a.userId, projectId: a.projectId });
      if (aiError) {
        await logRunEvent({ runId: run.id, level: "warn", message: aiError });
      }

      const aiOverrides: AiOverrides | undefined =
        ai?.provider === "gemini"
          ? { provider: "gemini", geminiApiKey: ai.geminiApiKey }
          : ai?.provider === "openai"
            ? {
                provider: "openai",
                openaiApiKey: ai.openaiApiKey,
                ...(ai.openaiBaseURL ? { openaiBaseURL: ai.openaiBaseURL } : {}),
              }
            : undefined;

      for (let i = 0; i < definition.steps.length; i++) {
        const step = definition.steps[i]!;
        const progress = Math.round((i / Math.max(1, definition.steps.length)) * 100);

        if (step.type === "fetch_findings") {
          const hoursBack = Math.max(1, Math.min(24 * 30, Number(step.params?.hoursBack ?? 24)));
          const limit = Math.max(5, Math.min(80, Number(step.params?.limit ?? 20)));
          const agentsFilter = (step.params?.agents ?? []).filter(Boolean);

          await logRunEvent({ runId: run.id, progress, message: `Fetching findings (last ${hoursBack}h, limit ${limit})` });

          const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
          const conds = [isNotNull(findings.publishedAt), gte(findings.publishedAt, since)];
          if (agentsFilter.length) conds.push(inArray(findings.agent, agentsFilter as any));
          const whereExpr = and(...conds);

          const rows = await db
            .select({
              agent: findings.agent,
              title: findings.title,
              cveId: findings.cveId,
              sourceUrl: findings.sourceUrl,
              publishedAt: findings.publishedAt,
            })
            .from(findings)
            .where(whereExpr)
            .orderBy(desc(findings.publishedAt))
            .limit(limit);

          ctx.findings = rows as any;
          continue;
        }

        if (step.type === "generate_report") {
          await logRunEvent({ runId: run.id, progress, message: "Generating report" });

          const stackRows = await db
            .select({ technology: userStack.technology, versionRange: userStack.versionRange, sector: userStack.sector })
            .from(userStack)
            .where(and(eq(userStack.userId, a.userId), eq(userStack.projectId, a.projectId)))
            .limit(50);

          const stackLines = stackRows.length
            ? stackRows.map((s) => `- ${s.technology}${s.versionRange ? ` (${s.versionRange})` : ""}${s.sector ? ` — ${s.sector}` : ""}`).join("\n")
            : "- (empty)";

          const findingsText = renderFindingsForPrompt((ctx.findings ?? []) as any);

          const prompt = [
            "You are a threat intel agent. Produce a concise Markdown report.",
            "",
            "User stack:",
            stackLines,
            "",
            "Recent findings:",
            findingsText,
            "",
            "Instructions:",
            asString(step.params?.prompt, ""),
            "",
            "Output requirements:",
            "- Markdown only",
            "- Include a short 'What changed' section",
            "- Include 3-8 prioritized bullets with rationale",
            "- Include links where available",
          ].join("\n");

          const report = await generateText({
            prompt,
            maxTokens: Math.max(200, Math.min(2000, Number(step.params?.maxTokens ?? 800))),
            temperature: Math.max(0, Math.min(1, Number(step.params?.temperature ?? 0.2))),
            ai: aiOverrides,
          });

          ctx.report = report;
          continue;
        }
      }

      const content = String(ctx.report ?? "").trim();
      const [out] = await db
        .insert(agentOutputs)
        .values({
          runId: run.id,
          projectId: a.projectId,
          userId: a.userId,
          agentKey: "custom",
          format: "markdown",
          content: content || "(empty)",
        })
        .returning({ id: agentOutputs.id });

      await db
        .update(customAgents)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(customAgents.id, a.id));

      await finishRun({
        runId: run.id,
        status: "succeeded",
        startedAt: run.startedAt,
        metrics: {
          customAgentId: a.id,
          outputId: out?.id ?? null,
          findingsConsidered: Array.isArray(ctx.findings) ? ctx.findings.length : 0,
          outputChars: content.length,
        },
      });
    } catch (err) {
      await logRunEvent({ runId: run.id, level: "error", message: "Failed" });
      await finishRun({ runId: run.id, status: "failed", startedAt: run.startedAt, error: err });
    }
  }
}

if (process.argv[1]?.endsWith("custom.ts")) {
  runCustomAgents().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
