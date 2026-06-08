export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopRoles } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";
import { generateTabletopPackage } from "../../../../../lib/tabletop/server";
import type { TabletopDifficultyLevel, TabletopScenarioType } from "../../../../../lib/tabletop/types";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

function normalizeScenarioType(v: unknown): TabletopScenarioType | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const allowed: TabletopScenarioType[] = ["ransomware", "supply_chain", "insider", "apt", "nation_state", "bcs"];
  return (allowed as readonly string[]).includes(s) ? (s as TabletopScenarioType) : null;
}

function normalizeDifficulty(v: unknown): TabletopDifficultyLevel | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const allowed: TabletopDifficultyLevel[] = ["beginner", "intermediate", "advanced"];
  return (allowed as readonly string[]).includes(s) ? (s as TabletopDifficultyLevel) : null;
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Tabletop exercises are available on Pro." }, { status: 403 });

  try {
    const rows = await db
      .select({
        id: tabletopExercises.id,
        title: tabletopExercises.title,
        status: tabletopExercises.status,
        scenarioType: tabletopExercises.scenarioType,
        actorName: tabletopExercises.actorName,
        difficultyLevel: tabletopExercises.difficultyLevel,
        durationMinutes: tabletopExercises.durationMinutes,
        generatedAt: tabletopExercises.generatedAt,
        createdAt: tabletopExercises.createdAt,
      })
      .from(tabletopExercises)
      .where(eq(tabletopExercises.projectId, ctx.project.id))
      .orderBy(desc(tabletopExercises.createdAt))
      .limit(200);

    return json({ ok: true, exercises: rows });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Tabletop exercises are available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const scenarioType = normalizeScenarioType(body?.scenarioType);
  const difficultyLevel = normalizeDifficulty(body?.difficultyLevel);
  const durationMinutes = Number(body?.durationMinutes ?? 0);
  const title = String(body?.title ?? "").trim();
  const actorId = String(body?.actorId ?? "").trim() || null;
  const actorMode = String(body?.actorMode ?? "").trim().toLowerCase() === "chosen" ? "chosen" : "suggest";
  const complianceTag = String(body?.complianceTag ?? "").trim() || null;

  if (!scenarioType) return json({ error: "scenarioType is required" }, { status: 400 });
  if (!difficultyLevel) return json({ error: "difficultyLevel is required" }, { status: 400 });
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return json({ error: "durationMinutes must be a positive integer" }, { status: 400 });
  if (title.length > 180) return json({ error: "title is too long" }, { status: 400 });
  if (complianceTag && complianceTag.length > 60) return json({ error: "complianceTag is too long" }, { status: 400 });

  let generated: Awaited<ReturnType<typeof generateTabletopPackage>>;
  try {
    generated = await generateTabletopPackage({
      projectId: ctx.project.id,
      userId: ctx.user.id,
      input: {
        title: title || undefined,
        scenarioType,
        difficultyLevel,
        durationMinutes: Math.trunc(durationMinutes),
        actorId,
        actorMode,
        complianceTag,
      },
    });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    const msg = String((err as any)?.message ?? err ?? "Unknown error");
    return json({ error: msg }, { status: 400 });
  }

  try {
    let exerciseId: string | null = null;
    try {
      const [ex] = await db
        .insert(tabletopExercises)
        .values({
          projectId: ctx.project.id,
          userId: ctx.user.id,
          title: generated.title,
          status: "draft" as any,
          scenarioType,
          actorId: generated.actor.actorId,
          actorName: generated.actor.actorName,
          difficultyLevel,
          durationMinutes: Math.trunc(durationMinutes),
          complianceTag,
          narrative: generated.ai.narrative,
          facilitatorGuide: `${generated.ai.facilitatorGuide}\n\nAAR Template\n\n${generated.ai.aarTemplate}`.slice(0, 120_000),
          generationInputs: generated.generationInputs as any,
          generatedAt: new Date(),
        })
        .returning({ id: tabletopExercises.id });

      exerciseId = ex?.id ?? null;
      if (!exerciseId) throw new Error("Failed to create exercise");

      await db.insert(tabletopInjects).values(
        generated.ai.injects.map((inj, i) => ({
          exerciseId,
          sequence: i + 1,
          tPlusMinutes: Math.max(0, Math.trunc(inj.tPlus)),
          title: inj.title,
          situation: inj.situation,
          attackTechniqueId: inj.techniqueId ?? null,
          discussionQuestions: inj.questions,
          evaluationCriteria: inj.criteria,
          curveballs: inj.curveballs ?? null,
          facilitatorTips: inj.facilitatorTips ?? null,
        }))
      );

      await db.insert(tabletopRoles).values(
        generated.ai.roles.map((r) => ({
          exerciseId,
          roleName: r.roleName,
          briefing: r.briefing,
          keyResponsibilities: r.responsibilities,
          documentsToHave: r.documentsToHave,
        }))
      );

      return json({ ok: true, id: exerciseId });
    } catch (err) {
      if (exerciseId) {
        try {
          await db.delete(tabletopExercises).where(eq(tabletopExercises.id, exerciseId));
        } catch {
          // ignore
        }
      }
      throw err;
    }
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
