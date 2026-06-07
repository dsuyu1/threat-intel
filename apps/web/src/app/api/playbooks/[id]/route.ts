export const runtime = "edge";

import type { NextRequest } from "next/server";
import { load as loadYaml } from "js-yaml";
import { getDb, playbooks } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";
import type { PlaybookContentFormat, PlaybookContentV1, PlaybookStatus } from "../../../../lib/playbooks/types";

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

function normalizeStatus(value: unknown): PlaybookStatus | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const allowed: PlaybookStatus[] = ["draft", "approved", "archived"];
  return (allowed as readonly string[]).includes(v) ? (v as PlaybookStatus) : null;
}

function normalizeContentFormat(value: unknown): PlaybookContentFormat | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const allowed: PlaybookContentFormat[] = ["json", "yaml"];
  return (allowed as readonly string[]).includes(v) ? (v as PlaybookContentFormat) : null;
}

function isPlaybookContentV1(value: unknown): value is PlaybookContentV1 {
  const v = value as any;
  return v && typeof v === "object" && v.version === 1 && typeof v.title === "string" && Array.isArray(v.phases);
}

function parsePlaybookContent(text: string, format: PlaybookContentFormat) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: false as const, error: "contentText cannot be empty" };

  try {
    const parsed = format === "yaml" ? loadYaml(raw) : JSON.parse(raw);
    if (!isPlaybookContentV1(parsed)) {
      return { ok: false as const, error: "contentText must be PlaybookContentV1 (version: 1)" };
    }
    return { ok: true as const, value: parsed };
  } catch (err) {
    const anyErr = err as any;
    return { ok: false as const, error: String(anyErr?.message ?? err ?? "Invalid content") };
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const { id } = await ctx.params;

  try {
    const [row] = await db
      .select({
        id: playbooks.id,
        title: playbooks.title,
        incidentType: playbooks.incidentType,
        status: playbooks.status,
        sourceKind: playbooks.sourceKind,
        sourceId: playbooks.sourceId,
        contextJson: playbooks.contextJson,
        contentJson: playbooks.contentJson,
        contentFormat: playbooks.contentFormat,
        contentText: playbooks.contentText,
        approvedAt: playbooks.approvedAt,
        createdAt: playbooks.createdAt,
        updatedAt: playbooks.updatedAt,
      })
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.projectId, viewer.project.id)))
      .limit(1);

    if (!row) return json({ error: "Playbook not found" }, { status: 404 });
    return json({ ok: true, playbook: row });
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as any;
  const status = normalizeStatus(body?.status);
  const title = body?.title != null ? String(body.title).trim() : null;
  const contentFormat = normalizeContentFormat(body?.contentFormat);
  const contentText = body?.contentText != null ? String(body.contentText) : null;

  if (body?.contentFormat != null && !contentFormat) return json({ error: "Invalid contentFormat" }, { status: 400 });

  if (!status && title == null && contentText == null && contentFormat == null) {
    return json({ error: "status, title, contentText, or contentFormat is required" }, { status: 400 });
  }
  if (title != null && !title) return json({ error: "title cannot be empty" }, { status: 400 });
  if (title != null && title.length > 180) return json({ error: "title is too long" }, { status: 400 });

  const patch: Record<string, any> = { updatedAt: new Date() };

  let existing: { status: unknown } | undefined;
  try {
    [existing] = await db
      .select({ status: playbooks.status })
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.projectId, viewer.project.id)))
      .limit(1);
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }

  if (!existing) return json({ error: "Playbook not found" }, { status: 404 });

  const currentStatus = String(existing.status ?? "draft") as PlaybookStatus;
  const nextStatus = (status ?? currentStatus) as PlaybookStatus;

  if (title != null) patch.title = title;

  if (status) {
    patch.status = status;
    if (status === "approved") {
      patch.approvedByUserId = viewer.user.id;
      patch.approvedAt = new Date();
    } else {
      patch.approvedByUserId = null;
      patch.approvedAt = null;
    }
  }

  if (contentText != null || contentFormat != null) {
    const fmt = contentFormat ?? ("json" as const);

    const canEdit =
      nextStatus === "draft" || (currentStatus === "draft" && nextStatus === "approved");
    if (!canEdit) return json({ error: "Playbook content can only be edited while in draft." }, { status: 409 });

    if (contentText == null) return json({ error: "contentText is required when setting contentFormat" }, { status: 400 });

    const parsed = parsePlaybookContent(contentText, fmt);
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

    patch.contentFormat = fmt;
    patch.contentText = contentText;
    patch.contentJson = parsed.value as any;
  }

  try {
    await db.update(playbooks).set(patch).where(and(eq(playbooks.id, id), eq(playbooks.projectId, viewer.project.id)));
    return json({ ok: true });
  } catch (err) {
    if (isMissingPlaybooksTable(err)) {
      return json({ error: "Playbooks tables are missing. Run pnpm db:migrate." }, { status: 503 });
    }
    throw err;
  }
}
