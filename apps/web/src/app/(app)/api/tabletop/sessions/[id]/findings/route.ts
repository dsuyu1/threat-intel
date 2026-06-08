export const runtime = "edge";

import { getDb, navigatorScenarios, tabletopExercises, tabletopFindings, tabletopInjects, tabletopSessions } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../../lib/tenancy";
import type { TabletopFindingSeverity } from "../../../../../../../lib/tabletop/types";

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

function normalizeSeverity(v: unknown): TabletopFindingSeverity | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const allowed: TabletopFindingSeverity[] = ["low", "medium", "high", "critical"];
  return (allowed as readonly string[]).includes(s) ? (s as TabletopFindingSeverity) : null;
}

function parseDueDate(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Tabletop exercises are available on Pro." }, { status: 403 });

  const { id } = await ctx2.params;
  const sessionId = String(id ?? "").trim();
  if (!sessionId) return json({ error: "Missing id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;
  const gap = String(body?.gap ?? "").trim();
  const severity = normalizeSeverity(body?.severity);
  const assignedTo = String(body?.assignedTo ?? "").trim() || null;
  const dueDate = parseDueDate(body?.dueDate);
  const linkedNavigatorScenarioId = String(body?.linkedNavigatorScenarioId ?? "").trim() || null;
  const injectId = String(body?.injectId ?? "").trim() || null;

  if (!gap) return json({ error: "gap is required" }, { status: 400 });
  if (!severity) return json({ error: "severity is required" }, { status: 400 });
  if (gap.length > 10_000) return json({ error: "gap is too long" }, { status: 400 });
  if (assignedTo && assignedTo.length > 160) return json({ error: "assignedTo is too long" }, { status: 400 });

  try {
    const [row] = await db
      .select({
        projectId: tabletopExercises.projectId,
        exerciseId: tabletopSessions.exerciseId,
        status: tabletopSessions.status,
        currentSequence: tabletopSessions.currentSequence,
      })
      .from(tabletopSessions)
      .innerJoin(tabletopExercises, eq(tabletopExercises.id, tabletopSessions.exerciseId))
      .where(eq(tabletopSessions.id, sessionId))
      .limit(1);

    if (!row) return json({ error: "Not found" }, { status: 404 });
    if (row.projectId !== viewer.project.id) return json({ error: "Not authorized" }, { status: 403 });
    if (row.status === ("completed" as any)) return json({ error: "Session is completed" }, { status: 400 });

    if (linkedNavigatorScenarioId) {
      const [sc] = await db
        .select({ id: navigatorScenarios.id })
        .from(navigatorScenarios)
        .where(and(eq(navigatorScenarios.id, linkedNavigatorScenarioId), eq(navigatorScenarios.projectId, viewer.project.id)))
        .limit(1);
      if (!sc) return json({ error: "linkedNavigatorScenarioId is not valid for this project" }, { status: 400 });
    }

    if (injectId) {
      const [inj] = await db
        .select({ id: tabletopInjects.id, sequence: tabletopInjects.sequence })
        .from(tabletopInjects)
        .where(and(eq(tabletopInjects.id, injectId), eq(tabletopInjects.exerciseId, row.exerciseId)))
        .limit(1);
      if (!inj) return json({ error: "injectId is invalid" }, { status: 400 });
      const currentSeq = Math.max(0, Number(row.currentSequence ?? 0));
      if (Number(inj.sequence) > currentSeq) return json({ error: "injectId is not released yet" }, { status: 400 });
    }

    const [created] = await db
      .insert(tabletopFindings)
      .values({
        sessionId,
        injectId,
        gap,
        severity: severity as any,
        assignedTo,
        dueDate,
        linkedNavigatorScenarioId,
        status: "open" as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: tabletopFindings.id });

    return json({ ok: true, id: created?.id ?? null });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "Tabletop tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

