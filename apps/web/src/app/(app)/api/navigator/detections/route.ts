export const runtime = "edge";

import {
  buildNavigatorDetectionPrompt,
  getDb,
  navigatorDetectionJobs,
  navigatorDetections,
  stripCodeFences,
} from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { getAiProvider, getChatModel, generateText } from "../../../../../lib/ai";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

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

function isMissingNavigatorDetectionJobsTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "");
  const msg = String(anyErr?.message ?? err ?? "");
  return (
    code === "42P01" ||
    code === "42703" ||
    msg.includes("navigator_detection_jobs") ||
    msg.includes('relation "navigator_detection_jobs"') ||
    (msg.includes('column "') && msg.includes("does not exist"))
  );
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
        id: navigatorDetections.id,
        format: navigatorDetections.format,
        content: navigatorDetections.content,
        lifecycleStatus: navigatorDetections.lifecycleStatus,
        reviewedAt: navigatorDetections.reviewedAt,
        reviewedBy: navigatorDetections.reviewedBy,
        deployedAt: navigatorDetections.deployedAt,
        retiredAt: navigatorDetections.retiredAt,
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

    let job: { status: string; error: string | null; updatedAt: string; createdAt: string } | null = null;
    try {
      const [j] = await db
        .select({
          status: navigatorDetectionJobs.status,
          error: navigatorDetectionJobs.error,
          updatedAt: navigatorDetectionJobs.updatedAt,
          createdAt: navigatorDetectionJobs.createdAt,
        })
        .from(navigatorDetectionJobs)
        .where(
          and(
            eq(navigatorDetectionJobs.projectId, ctx.project.id),
            eq(navigatorDetectionJobs.scenarioId, scenarioId),
            eq(navigatorDetectionJobs.techniqueId, techniqueId)
          )
        )
        .orderBy(desc(navigatorDetectionJobs.updatedAt))
        .limit(1);

      if (j) {
        job = {
          status: String(j.status),
          error: j.error ? String(j.error) : null,
          updatedAt: new Date(j.updatedAt as any).toISOString(),
          createdAt: new Date(j.createdAt as any).toISOString(),
        };
      }
    } catch (err) {
      if (!isMissingNavigatorDetectionJobsTable(err)) throw err;
      job = null;
    }

    return json({ detections: rows, job });
  } catch (err) {
    if (isMissingNavigatorDetectionsTable(err)) {
      return json({
        detections: [],
        job: null,
        warning: "Detections tables are missing or out of date; run pnpm --filter @ti/db db:migrate to enable caching.",
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

  // Best-effort caching (feature still works without migrations).
  if (!regenerate) {
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
          techniqueName: cached.techniqueName ?? techniqueId,
          lifecycleStatus: cached.lifecycleStatus ?? "draft",
          reviewedAt: cached.reviewedAt ?? null,
          deployedAt: cached.deployedAt ?? null,
          retiredAt: cached.retiredAt ?? null,
          content: cached.content,
          updatedAt: cached.updatedAt,
        });
      }
    } catch (err) {
      if (!isMissingNavigatorDetectionsTable(err)) throw err;
    }
  }

  const sigmaRuleId = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);

  let prompt = "";
  let techniqueName = techniqueId;
  try {
    const res = await buildNavigatorDetectionPrompt({
      db,
      projectId: ctx.project.id,
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
          userId: ctx.user.id,
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
    lifecycleStatus: "draft",
    content,
    updatedAt,
  });
}
