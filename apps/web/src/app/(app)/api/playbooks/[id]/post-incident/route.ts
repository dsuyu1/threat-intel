export const runtime = "edge";

import { and, asc, eq } from "drizzle-orm";
import {
  getDb,
  incidents,
  playbookIncidentReviewSteps,
  playbookIncidentReviewToolActions,
  playbookIncidentReviews,
  playbooks,
} from "@ti/db";
import { getViewerContext } from "../../../../../../lib/tenancy";
import type { PlaybookContentV1 } from "../../../../../../lib/playbooks/types";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function sumEstimatedMinutes(content: PlaybookContentV1) {
  let total = 0;
  for (const p of content.phases) {
    total += Number(p.estimatedMinutes ?? 0);
    for (const s of p.steps) total += Number(s.estimatedMinutes ?? 0);
  }
  return Math.max(0, Math.round(total));
}

function computeActualMinutes(params: { detectedAt: Date | null; containedAt: Date | null }) {
  if (!params.detectedAt || !params.containedAt) return null;
  const ms = params.containedAt.getTime() - params.detectedAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(0, Math.round(ms / 60_000));
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeEffectivenessScore(params: {
  estimatedTotalMinutes: number;
  actualTotalMinutes: number | null;
  totalSteps: number;
  skippedSteps: number;
  totalToolActions: number;
  failedToolActions: number;
}) {
  const stepCompletion =
    1 - params.skippedSteps / Math.max(1, Number(params.totalSteps ?? 0));
  const toolReliability =
    1 - params.failedToolActions / Math.max(1, Number(params.totalToolActions ?? 0));

  if (typeof params.actualTotalMinutes === "number") {
    const denom = Math.max(1, Number(params.estimatedTotalMinutes ?? 0));
    const durationAccuracy =
      1 - Math.min(1, Math.abs(params.actualTotalMinutes - params.estimatedTotalMinutes) / denom);
    return clampScore(100 * (0.5 * durationAccuracy + 0.3 * stepCompletion + 0.2 * toolReliability));
  }

  return clampScore(100 * (0.6 * stepCompletion + 0.4 * toolReliability));
}

function isPlaybookContentV1(value: unknown): value is PlaybookContentV1 {
  const v = value as any;
  return v && typeof v === "object" && v.version === 1 && typeof v.title === "string" && Array.isArray(v.phases);
}

function buildExpectedFromContent(content: PlaybookContentV1) {
  const steps: Array<{ stepId: string; stepTitle: string }> = [];
  const toolActions: Array<{ stepId: string; actionIndex: number; tool: string; label: string }> = [];

  for (const p of content.phases) {
    for (const s of p.steps) {
      steps.push({ stepId: s.id, stepTitle: s.title });
      const actions = s.toolActions ?? [];
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i]!;
        toolActions.push({
          stepId: s.id,
          actionIndex: i,
          tool: a.tool,
          label: a.label,
        });
      }
    }
  }

  return { steps, toolActions };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: playbookId } = await ctx.params;
  const incidentId = new URL(req.url).searchParams.get("incidentId") ?? "";
  if (!incidentId) return json({ error: "incidentId is required" }, { status: 400 });

  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });

  try {
    const [review] = await db
      .select({
        id: playbookIncidentReviews.id,
        notes: playbookIncidentReviews.notes,
        estimatedTotalMinutes: playbookIncidentReviews.estimatedTotalMinutes,
        actualTotalMinutes: playbookIncidentReviews.actualTotalMinutes,
        totalSteps: playbookIncidentReviews.totalSteps,
        skippedSteps: playbookIncidentReviews.skippedSteps,
        totalToolActions: playbookIncidentReviews.totalToolActions,
        failedToolActions: playbookIncidentReviews.failedToolActions,
        effectivenessScore: playbookIncidentReviews.effectivenessScore,
        createdAt: playbookIncidentReviews.createdAt,
        updatedAt: playbookIncidentReviews.updatedAt,
      })
      .from(playbookIncidentReviews)
      .where(
        and(
          eq(playbookIncidentReviews.projectId, viewer.project.id),
          eq(playbookIncidentReviews.playbookId, playbookId),
          eq(playbookIncidentReviews.incidentId, incidentId)
        )
      )
      .limit(1);

    if (!review) return json({ ok: true, review: null });

    const steps = await db
      .select({
        stepId: playbookIncidentReviewSteps.stepId,
        stepTitle: playbookIncidentReviewSteps.stepTitle,
        status: playbookIncidentReviewSteps.status,
        actualMinutes: playbookIncidentReviewSteps.actualMinutes,
        notes: playbookIncidentReviewSteps.notes,
      })
      .from(playbookIncidentReviewSteps)
      .where(eq(playbookIncidentReviewSteps.reviewId, review.id))
      .orderBy(asc(playbookIncidentReviewSteps.stepId));

    const toolActions = await db
      .select({
        stepId: playbookIncidentReviewToolActions.stepId,
        actionIndex: playbookIncidentReviewToolActions.actionIndex,
        tool: playbookIncidentReviewToolActions.tool,
        label: playbookIncidentReviewToolActions.label,
        status: playbookIncidentReviewToolActions.status,
        error: playbookIncidentReviewToolActions.error,
      })
      .from(playbookIncidentReviewToolActions)
      .where(eq(playbookIncidentReviewToolActions.reviewId, review.id))
      .orderBy(asc(playbookIncidentReviewToolActions.stepId), asc(playbookIncidentReviewToolActions.actionIndex));

    return json({ ok: true, review: { ...review, steps, toolActions } });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Review tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: playbookId } = await ctx.params;
  const incidentId = new URL(req.url).searchParams.get("incidentId") ?? "";
  if (!incidentId) return json({ error: "incidentId is required" }, { status: 400 });

  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });

  const body = (await req.json().catch(() => null)) as any;
  const notes = body?.notes != null ? String(body.notes) : null;
  const stepsIn = Array.isArray(body?.steps) ? (body.steps as any[]) : null;
  const toolActionsIn = Array.isArray(body?.toolActions) ? (body.toolActions as any[]) : null;
  if (!stepsIn) return json({ error: "steps is required" }, { status: 400 });
  if (!toolActionsIn) return json({ error: "toolActions is required" }, { status: 400 });

  const playbookRow = await (async () => {
    try {
      const [row] = await db
        .select({ id: playbooks.id, contentJson: playbooks.contentJson })
        .from(playbooks)
        .where(and(eq(playbooks.id, playbookId), eq(playbooks.projectId, viewer.project.id)))
        .limit(1);
      return row ?? null;
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code === "42P01") return null;
      throw err;
    }
  })();
  if (!playbookRow) return json({ error: "Playbook not found" }, { status: 404 });

  if (!isPlaybookContentV1(playbookRow.contentJson)) {
    return json({ error: "Playbook content is not in PlaybookContentV1 format" }, { status: 400 });
  }

  const expected = buildExpectedFromContent(playbookRow.contentJson);
  const expectedSteps = expected.steps;
  const expectedToolActions = expected.toolActions;

  if (stepsIn.length !== expectedSteps.length) {
    return json({ error: `Expected ${expectedSteps.length} steps, got ${stepsIn.length}` }, { status: 400 });
  }
  if (toolActionsIn.length !== expectedToolActions.length) {
    return json({ error: `Expected ${expectedToolActions.length} toolActions, got ${toolActionsIn.length}` }, { status: 400 });
  }

  const stepsById = new Map(expectedSteps.map((s) => [s.stepId, s.stepTitle]));
  const seenSteps = new Set<string>();
  const normalizedSteps: Array<{
    stepId: string;
    stepTitle: string;
    status: "done" | "skipped";
    actualMinutes: number | null;
    notes: string | null;
  }> = [];

  for (const raw of stepsIn) {
    const stepId = String(raw?.stepId ?? "").trim();
    const stepTitle = stepsById.get(stepId);
    if (!stepId || !stepTitle) return json({ error: `Unknown stepId: ${stepId || "(empty)"}` }, { status: 400 });
    if (seenSteps.has(stepId)) return json({ error: `Duplicate stepId: ${stepId}` }, { status: 400 });
    seenSteps.add(stepId);

    const statusRaw = String(raw?.status ?? "").trim().toLowerCase();
    const status = statusRaw === "skipped" ? "skipped" : "done";

    const actualMinutesRaw = raw?.actualMinutes == null ? null : Number(raw.actualMinutes);
    const actualMinutes = actualMinutesRaw == null || !Number.isFinite(actualMinutesRaw) ? null : Math.max(0, Math.round(actualMinutesRaw));

    const n = raw?.notes != null ? String(raw.notes) : null;
    normalizedSteps.push({ stepId, stepTitle, status, actualMinutes, notes: n });
  }

  const expectedToolKeys = new Map<string, { tool: string; label: string }>();
  for (const a of expectedToolActions) {
    expectedToolKeys.set(`${a.stepId}:${a.actionIndex}`, { tool: a.tool, label: a.label });
  }

  const seenTool = new Set<string>();
  const normalizedToolActions: Array<{
    stepId: string;
    actionIndex: number;
    tool: string;
    label: string;
    status: "succeeded" | "failed" | "not_used";
    error: string | null;
  }> = [];

  for (const raw of toolActionsIn) {
    const stepId = String(raw?.stepId ?? "").trim();
    const actionIndexRaw = Number(raw?.actionIndex);
    const actionIndex = Number.isFinite(actionIndexRaw) ? Math.max(0, Math.trunc(actionIndexRaw)) : NaN;
    if (!stepId || !Number.isFinite(actionIndex)) {
      return json({ error: "Invalid toolActions entry (stepId/actionIndex)" }, { status: 400 });
    }
    const key = `${stepId}:${actionIndex}`;
    const meta = expectedToolKeys.get(key);
    if (!meta) return json({ error: `Unknown tool action: ${key}` }, { status: 400 });
    if (seenTool.has(key)) return json({ error: `Duplicate tool action: ${key}` }, { status: 400 });
    seenTool.add(key);

    const statusRaw = String(raw?.status ?? "").trim().toLowerCase();
    const status =
      statusRaw === "failed" ? "failed" : statusRaw === "succeeded" ? "succeeded" : "not_used";
    const errText = raw?.error != null ? String(raw.error) : null;
    normalizedToolActions.push({ stepId, actionIndex, tool: meta.tool, label: meta.label, status, error: errText });
  }

  const [incident] = await db
    .select({ detectedAt: incidents.detectedAt, containedAt: incidents.containedAt })
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.projectId, viewer.project.id)))
    .limit(1);
  if (!incident) return json({ error: "Incident not found" }, { status: 404 });

  const estimatedTotalMinutes = sumEstimatedMinutes(playbookRow.contentJson);
  const actualTotalMinutes = computeActualMinutes({ detectedAt: incident.detectedAt, containedAt: incident.containedAt });

  const totalSteps = expectedSteps.length;
  const totalToolActions = expectedToolActions.length;
  const skippedSteps = normalizedSteps.filter((s) => s.status === "skipped").length;
  const failedToolActions = normalizedToolActions.filter((a) => a.status === "failed").length;
  const effectivenessScore = computeEffectivenessScore({
    estimatedTotalMinutes,
    actualTotalMinutes,
    totalSteps,
    skippedSteps,
    totalToolActions,
    failedToolActions,
  });

  const now = new Date();

  let reviewId: string | null = null;
  try {
    const [row] = await db
      .insert(playbookIncidentReviews)
      .values({
        projectId: viewer.project.id,
        playbookId,
        incidentId,
        reviewerUserId: viewer.user.id,
        notes,
        estimatedTotalMinutes,
        actualTotalMinutes,
        totalSteps,
        skippedSteps,
        totalToolActions,
        failedToolActions,
        effectivenessScore,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [playbookIncidentReviews.playbookId, playbookIncidentReviews.incidentId],
        set: {
          reviewerUserId: viewer.user.id,
          notes,
          estimatedTotalMinutes,
          actualTotalMinutes,
          totalSteps,
          skippedSteps,
          totalToolActions,
          failedToolActions,
          effectivenessScore,
          updatedAt: now,
        },
      })
      .returning({ id: playbookIncidentReviews.id });

    reviewId = row?.id ?? null;
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Review tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!reviewId) {
    const [row] = await db
      .select({ id: playbookIncidentReviews.id })
      .from(playbookIncidentReviews)
      .where(and(eq(playbookIncidentReviews.playbookId, playbookId), eq(playbookIncidentReviews.incidentId, incidentId)))
      .limit(1);
    reviewId = row?.id ?? null;
  }
  if (!reviewId) return json({ error: "Failed to save review" }, { status: 500 });

  await db.delete(playbookIncidentReviewSteps).where(eq(playbookIncidentReviewSteps.reviewId, reviewId));
  await db.delete(playbookIncidentReviewToolActions).where(eq(playbookIncidentReviewToolActions.reviewId, reviewId));

  if (normalizedSteps.length) {
    await db.insert(playbookIncidentReviewSteps).values(
      normalizedSteps.map((s) => ({
        reviewId,
        stepId: s.stepId,
        stepTitle: s.stepTitle,
        status: s.status as any,
        actualMinutes: s.actualMinutes ?? undefined,
        notes: s.notes ?? undefined,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }

  if (normalizedToolActions.length) {
    await db.insert(playbookIncidentReviewToolActions).values(
      normalizedToolActions.map((a) => ({
        reviewId,
        stepId: a.stepId,
        actionIndex: a.actionIndex,
        tool: a.tool,
        label: a.label,
        status: a.status as any,
        error: a.error ?? undefined,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }

  return json({ ok: true, reviewId, effectivenessScore });
}

