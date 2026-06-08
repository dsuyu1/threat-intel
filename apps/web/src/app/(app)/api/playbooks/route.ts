export const runtime = "edge";

import { getDb, playbooks } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";
import { defaultPlaybookTitle, generatePlaybookContent, getFindingContext, getScenarioContext, getToolAvailability, inferIncidentType } from "../../../../lib/playbooks/server";
import type { PlaybookIncidentType, PlaybookSourceKind } from "../../../../lib/playbooks/types";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingPlaybooksTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? "");
  const msg = String(anyErr?.message ?? err ?? "");
  return code === "42P01" || msg.includes('playbooks') || msg.includes('relation "playbooks"');
}

function normalizeSourceKind(value: unknown): PlaybookSourceKind {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "navigator_scenario" || v === "finding") return v;
  return "manual";
}

function normalizeIncidentType(value: unknown): PlaybookIncidentType | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const allowed: PlaybookIncidentType[] = [
    "vulnerability_exploitation",
    "credential_compromise",
    "ransomware",
    "supply_chain",
    "lateral_movement",
    "data_exfiltration",
  ];
  return (allowed as readonly string[]).includes(v) ? (v as PlaybookIncidentType) : null;
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  try {
    const rows = await db
      .select({
        id: playbooks.id,
        title: playbooks.title,
        incidentType: playbooks.incidentType,
        status: playbooks.status,
        sourceKind: playbooks.sourceKind,
        createdAt: playbooks.createdAt,
        updatedAt: playbooks.updatedAt,
      })
      .from(playbooks)
      .where(eq(playbooks.projectId, ctx.project.id))
      .orderBy(desc(playbooks.updatedAt), desc(playbooks.createdAt))
      .limit(200);

    return json({ ok: true, playbooks: rows });
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  const body = (await req.json().catch(() => null)) as any;
  const sourceKind = normalizeSourceKind(body?.sourceKind);
  const sourceId = body?.sourceId ? String(body.sourceId).trim() : "";
  const requestedIncidentType = normalizeIncidentType(body?.incidentType);
  const requestedTitle = body?.title ? String(body.title).trim() : "";

  if ((sourceKind === "navigator_scenario" || sourceKind === "finding") && !sourceId) {
    return json({ error: "sourceId is required for sourceKind navigator_scenario or finding" }, { status: 400 });
  }

  const tools = await getToolAvailability({ projectId: ctx.project.id });
  const scenario = sourceKind === "navigator_scenario" ? await getScenarioContext({ scenarioId: sourceId, projectId: ctx.project.id }) : null;
  const finding = sourceKind === "finding" ? await getFindingContext({ findingId: sourceId }) : null;

  if (sourceKind === "navigator_scenario" && !scenario) return json({ error: "Scenario not found" }, { status: 404 });
  if (sourceKind === "finding" && !finding) return json({ error: "Finding not found" }, { status: 404 });

  const incidentType = inferIncidentType({
    requested: requestedIncidentType,
    sourceKind,
    scenario,
    finding,
  });

  const title = requestedTitle || defaultPlaybookTitle({ incidentType, sourceKind, scenario, finding });

  const { content, context } = generatePlaybookContent({
    title,
    incidentType,
    source: sourceKind === "manual" ? null : { kind: sourceKind, id: sourceId },
    tools,
    scenario,
    finding,
  });

  const now = new Date();

  try {
    const [created] = await db
      .insert(playbooks)
      .values({
        projectId: ctx.project.id,
        createdByUserId: ctx.user.id,
        sourceKind: sourceKind as any,
        sourceId: sourceId ? sourceId : null,
        incidentType: incidentType as any,
        title,
        status: "draft" as any,
        contextJson: context,
        contentJson: content as any,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: playbooks.id });

    return json({ ok: true, id: created?.id ?? null });
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }
}
