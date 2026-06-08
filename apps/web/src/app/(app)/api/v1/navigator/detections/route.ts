export const runtime = "edge";
export const dynamic = "force-dynamic";

import {
  buildNavigatorDetectionPrompt,
  getDb,
  navigatorDetections,
  navigatorScenarios,
  stripCodeFences,
} from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { getAiProvider, getChatModel, generateText } from "../../../../../../lib/ai";
import { requireApiKey } from "../../../../../../lib/api-auth";
import { getUserTierById } from "../../../../../../lib/api-key-tier";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";

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

function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
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
  return (
    code === "42P01" ||
    code === "42703" ||
    msg.includes("navigator_detections") ||
    msg.includes('relation "navigator_detections"') ||
    (msg.includes('column "') && msg.includes("does not exist"))
  );
}

function normalizeTechniqueId(raw: unknown) {
  const v = String(raw ?? "").trim().toUpperCase();
  return /^T\d{4}(\.\d{3})?$/.test(v) ? v : null;
}

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { scope: "detections:generate" });
  if (!auth.ok) return auth.res;

  const tier = await getUserTierById(auth.apiKey.userId);
  const access = hasNavigatorAccess({ tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const techniqueId = normalizeTechniqueId(body?.techniqueId);
  if (!techniqueId) return json({ error: "techniqueId must be a T####(.###)" }, { status: 400 });

  const requestedScenarioId = body?.scenarioId ? String(body.scenarioId).trim() : "";
  const formatsRaw = Array.isArray(body?.formats) ? body.formats : null;
  const formats = unique(
    (formatsRaw?.length ? formatsRaw : FORMATS)
      .map((f: unknown) => normalizeFormat(f))
      .filter(Boolean) as DetectionFormat[]
  );
  if (!formats.length) return json({ error: `formats must include one of: ${FORMATS.join(", ")}` }, { status: 400 });

  const db = getDb();

  const scenarioId = await (async () => {
    if (requestedScenarioId) return requestedScenarioId;
    const [row] = await db
      .select({ id: navigatorScenarios.id })
      .from(navigatorScenarios)
      .where(
        and(
          eq(navigatorScenarios.projectId, auth.apiKey.projectId),
          eq(navigatorScenarios.targetKind, "technique"),
          eq(navigatorScenarios.targetId, techniqueId)
        )
      )
      .orderBy(desc(navigatorScenarios.score), desc(navigatorScenarios.computedAt))
      .limit(1);
    return row?.id ?? "";
  })();

  if (!scenarioId) {
    return json({ error: "No scenario found for this technique in this project. Create or compute a scenario first." }, { status: 404 });
  }

  const provider = getAiProvider();
  const model = getChatModel();

  const date = new Date().toISOString().slice(0, 10);
  const sigmaRuleIdBase = crypto.randomUUID();

  const results: Record<string, any> = {};

  for (const format of formats) {
    // Best-effort caching (feature still works without migrations).
    try {
      const [cached] = await db
        .select({
          content: navigatorDetections.content,
          lifecycleStatus: navigatorDetections.lifecycleStatus,
          reviewedAt: navigatorDetections.reviewedAt,
          deployedAt: navigatorDetections.deployedAt,
          retiredAt: navigatorDetections.retiredAt,
          updatedAt: navigatorDetections.updatedAt,
          model: navigatorDetections.model,
          techniqueName: navigatorDetections.techniqueName,
        })
        .from(navigatorDetections)
        .where(
          and(
            eq(navigatorDetections.projectId, auth.apiKey.projectId),
            eq(navigatorDetections.scenarioId, scenarioId),
            eq(navigatorDetections.techniqueId, techniqueId),
            eq(navigatorDetections.format, format)
          )
        )
        .limit(1);

      if (cached?.content) {
        results[format] = {
          ok: true,
          cached: true,
          persisted: true,
          provider,
          model: cached.model ?? null,
          format,
          techniqueId,
          techniqueName: cached.techniqueName ?? techniqueId,
          lifecycleStatus: cached.lifecycleStatus ?? "draft",
          reviewedAt: cached.reviewedAt ?? null,
          deployedAt: cached.deployedAt ?? null,
          retiredAt: cached.retiredAt ?? null,
          content: cached.content,
          updatedAt: cached.updatedAt ? new Date(cached.updatedAt as any).toISOString() : null,
        };
        continue;
      }
    } catch (err) {
      if (!isMissingNavigatorDetectionsTable(err)) throw err;
    }

    const sigmaRuleId = `${sigmaRuleIdBase}-${format}`;

    let prompt = "";
    let techniqueName = techniqueId;
    try {
      const res = await buildNavigatorDetectionPrompt({
        db,
        projectId: auth.apiKey.projectId,
        scenarioId,
        techniqueId,
        format,
        sigmaRuleId,
        date,
      });
      prompt = res.prompt;
      techniqueName = res.techniqueName ?? techniqueId;
    } catch (err) {
      const msg = safeErrorMessage(err);
      const status = /Scenario not found/i.test(msg) ? 404 : 500;
      return json({ error: msg }, { status });
    }

    let content = "";
    try {
      content = await generateText({ prompt, temperature: 0.15, maxTokens: 1100 });
      content = stripCodeFences(content);
    } catch (err) {
      const msg = safeErrorMessage(err);
      const status = /OPENAI_API_KEY|GEMINI_API_KEY/i.test(msg) ? 400 : 500;
      return json({ error: msg }, { status });
    }

    let persisted = false;
    let updatedAt: string | null = null;
    try {
      const now = new Date();
      const [row] = await db
        .insert(navigatorDetections)
        .values({
          projectId: auth.apiKey.projectId,
          userId: auth.apiKey.userId,
          scenarioId,
          techniqueId,
          techniqueName,
          format,
          content,
          model,
          lifecycleStatus: "draft",
          reviewedAt: null,
          reviewedBy: null,
          deployedAt: null,
          retiredAt: null,
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
            userId: auth.apiKey.userId,
            techniqueName,
            content,
            model,
            lifecycleStatus: "draft",
            reviewedAt: null,
            reviewedBy: null,
            deployedAt: null,
            retiredAt: null,
            updatedAt: now,
          },
        })
        .returning({ updatedAt: navigatorDetections.updatedAt });

      persisted = true;
      updatedAt = row?.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    } catch (err) {
      if (!isMissingNavigatorDetectionsTable(err)) throw err;
      persisted = false;
    }

    results[format] = {
      ok: true,
      cached: false,
      persisted,
      provider,
      model,
      format,
      techniqueId,
      techniqueName,
      lifecycleStatus: "draft",
      content,
      updatedAt,
    };
  }

  return json({
    ok: true,
    scenarioId,
    techniqueId,
    results,
  });
}

