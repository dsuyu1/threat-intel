export const runtime = "edge";

import { getDb, navigatorActions, navigatorActionSlaEvents, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function actionsToCsv(rows: Array<Record<string, unknown>>) {
  const headers = [
    "id",
    "title",
    "status",
    "slaTier",
    "dueDate",
    "scenarioId",
    "scenarioTitle",
    "scenarioScore",
  ] as const;

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];

  return `\uFEFF${lines.join("\n")}\n`;
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const download = url.searchParams.get("download") === "1";

  const rows = await db
    .select({
      id: navigatorActions.id,
      title: navigatorActions.title,
      status: navigatorActions.status,
      slaTier: navigatorActions.slaTier,
      dueDate: navigatorActions.dueDate,
      scenarioId: navigatorActions.scenarioId,
      scenarioTitle: navigatorScenarios.title,
      scenarioScore: navigatorScenarios.score,
    })
    .from(navigatorActions)
    .innerJoin(navigatorScenarios, eq(navigatorScenarios.id, navigatorActions.scenarioId))
    .where(and(eq(navigatorActions.projectId, ctx.project.id), eq(navigatorScenarios.projectId, ctx.project.id)))
    .orderBy(asc(navigatorActions.status), desc(navigatorScenarios.score), asc(navigatorActions.dueDate));

  try {
    const now = Date.now();
    const overdue = rows.filter((r) => {
      if (String(r.status) === "done") return false;
      if (!r.dueDate) return false;
      const due = r.dueDate instanceof Date ? r.dueDate.getTime() : new Date(r.dueDate as any).getTime();
      return Number.isFinite(due) && due < now;
    });

    if (overdue.length) {
      await db
        .insert(navigatorActionSlaEvents)
        .values(
          overdue.map((r) => ({
            projectId: ctx.project.id,
            actionId: r.id,
            kind: "breached" as const,
            dueDate: r.dueDate as any,
            at: new Date(),
          }))
        )
        .onConflictDoNothing();
    }
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code !== "42P01") throw err;
  }

  if (format === "csv") {
    const csv = actionsToCsv(rows as any);
    const filename = `navigator-actions-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (format === "json" && download) {
    const filename = `navigator-actions-${new Date().toISOString().slice(0, 10)}.json`;
    return json(
      { actions: rows },
      {
        headers: {
          "content-disposition": `attachment; filename="${filename}"`,
        },
      }
    );
  }

  return json({ actions: rows });
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const scenarioId = String(body?.scenarioId ?? "");
  const title = String(body?.title ?? "").trim();
  const slaTierIn = String(body?.slaTier ?? "").trim().toLowerCase();
  const slaTier =
    slaTierIn === "critical" || slaTierIn === "high" || slaTierIn === "medium" || slaTierIn === "low"
      ? slaTierIn
      : "high";

  const now = new Date();
  const dueDateProvided = Object.prototype.hasOwnProperty.call(body ?? {}, "dueDate");
  let dueDate: Date | null = null;
  if (dueDateProvided) {
    if (body?.dueDate === null || body?.dueDate === "") {
      dueDate = null;
    } else {
      const dt = new Date(String(body.dueDate));
      if (!Number.isFinite(dt.getTime())) return json({ error: "dueDate must be a valid date" }, { status: 400 });
      dueDate = dt;
    }
  } else {
    const ms =
      slaTier === "critical"
        ? 24 * 60 * 60 * 1000
        : slaTier === "high"
          ? 7 * 24 * 60 * 60 * 1000
          : slaTier === "medium"
            ? 30 * 24 * 60 * 60 * 1000
            : 90 * 24 * 60 * 60 * 1000;
    dueDate = new Date(now.getTime() + ms);
  }
  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!title) return json({ error: "title is required" }, { status: 400 });

  const [scenario] = await db
    .select({ id: navigatorScenarios.id })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
    .limit(1);
  if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });

  const [row] = await db
    .insert(navigatorActions)
    .values({
      projectId: ctx.project.id,
      userId: ctx.user.id,
      scenarioId,
      title,
      slaTier,
      dueDate,
    })
    .returning({ id: navigatorActions.id });

  return json({ ok: true, id: row?.id ?? null });
}
