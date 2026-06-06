export const runtime = "edge";

import { getDb, navigatorActions, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { getViewerContext } from "../../../../lib/tenancy";

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
      dueDate: navigatorActions.dueDate,
      scenarioId: navigatorActions.scenarioId,
      scenarioTitle: navigatorScenarios.title,
      scenarioScore: navigatorScenarios.score,
    })
    .from(navigatorActions)
    .innerJoin(navigatorScenarios, eq(navigatorScenarios.id, navigatorActions.scenarioId))
    .where(and(eq(navigatorActions.projectId, ctx.project.id), eq(navigatorScenarios.projectId, ctx.project.id)))
    .orderBy(asc(navigatorActions.status), desc(navigatorScenarios.score), asc(navigatorActions.dueDate));

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
  const dueDate = body?.dueDate ? new Date(String(body.dueDate)) : null;
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
      dueDate: dueDate && Number.isFinite(dueDate.getTime()) ? dueDate : undefined,
    })
    .returning({ id: navigatorActions.id });

  return json({ ok: true, id: row?.id ?? null });
}
