export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, playbooks } from "@ti/db";
import { requireApiKey } from "../../../../../lib/api-auth";
import { defaultPlaybookTitle, generatePlaybookContent, getToolAvailability, inferIncidentType } from "../../../../../lib/playbooks/server";
import type { PlaybookContentV1, PlaybookIncidentType } from "../../../../../lib/playbooks/types";

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
  return code === "42P01" || msg.includes("playbooks") || msg.includes('relation "playbooks"');
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

const MAX_DESCRIPTION_CHARS = 20_000;

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { scope: "playbooks:write" });
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => null)) as any;
  const incidentDescription = String(body?.incidentDescription ?? "").trim();
  if (!incidentDescription) return json({ error: "incidentDescription is required" }, { status: 400 });
  if (incidentDescription.length > MAX_DESCRIPTION_CHARS) {
    return json({ error: `incidentDescription is too long (max ${MAX_DESCRIPTION_CHARS} characters)` }, { status: 400 });
  }

  const requestedIncidentType = normalizeIncidentType(body?.incidentType);
  const requestedTitle = body?.title ? String(body.title).trim() : "";

  const db = getDb();

  const tools = await getToolAvailability({ projectId: auth.apiKey.projectId });
  const incidentType = inferIncidentType({
    requested: requestedIncidentType,
    sourceKind: "manual",
    scenario: null,
    finding: null,
  });

  const title = requestedTitle || defaultPlaybookTitle({ incidentType, sourceKind: "manual", scenario: null, finding: null });

  const { content: baseContent, context: baseContext } = generatePlaybookContent({
    title,
    incidentType,
    source: null,
    tools,
    scenario: null,
    finding: null,
  });

  const content: PlaybookContentV1 = {
    ...baseContent,
    executiveSummary: `${baseContent.executiveSummary}\n\nIncident description:\n${incidentDescription}`,
  };

  const context = { ...baseContext, incidentDescription };

  const now = new Date();
  try {
    const [created] = await db
      .insert(playbooks)
      .values({
        projectId: auth.apiKey.projectId,
        createdByUserId: auth.apiKey.userId,
        sourceKind: "manual" as any,
        sourceId: null,
        incidentType: incidentType as any,
        title,
        status: "draft" as any,
        contextJson: context,
        contentJson: content as any,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: playbooks.id });

    return json({
      ok: true,
      playbookId: created?.id ?? null,
      title,
      incidentType,
      content,
    });
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }
}
