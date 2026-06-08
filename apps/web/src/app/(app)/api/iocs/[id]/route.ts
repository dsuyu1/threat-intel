export const runtime = "edge";

import { getDb, iocEnrichments, iocEnrichmentJobs, iocSources, iocs } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const p = await params;
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "IOC management is available on Pro." }, { status: 403 });

  try {
    const [row] = await db
      .select({
        id: iocs.id,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
        tags: iocs.tags,
        firstSeenAt: iocs.firstSeenAt,
        lastSeenAt: iocs.lastSeenAt,
        createdAt: iocs.createdAt,
        updatedAt: iocs.updatedAt,
      })
      .from(iocs)
      .where(and(eq(iocs.projectId, ctx.project.id), eq(iocs.id, p.id)))
      .limit(1);

    if (!row) return json({ error: "IOC not found" }, { status: 404 });

    const sources = await db
      .select({
        id: iocSources.id,
        sourceKind: iocSources.sourceKind,
        connectionId: iocSources.connectionId,
        externalId: iocSources.externalId,
        externalUrl: iocSources.externalUrl,
        confidence: iocSources.confidence,
        firstSeenAt: iocSources.firstSeenAt,
        lastSeenAt: iocSources.lastSeenAt,
        createdAt: iocSources.createdAt,
        updatedAt: iocSources.updatedAt,
      })
      .from(iocSources)
      .where(and(eq(iocSources.projectId, ctx.project.id), eq(iocSources.iocId, row.id)))
      .orderBy(desc(iocSources.lastSeenAt), desc(iocSources.createdAt))
      .limit(200);

    const enrichments = await db
      .select({
        id: iocEnrichments.id,
        provider: iocEnrichments.provider,
        fetchedAt: iocEnrichments.fetchedAt,
        expiresAt: iocEnrichments.expiresAt,
        error: iocEnrichments.error,
        rawJson: iocEnrichments.rawJson,
        createdAt: iocEnrichments.createdAt,
        updatedAt: iocEnrichments.updatedAt,
      })
      .from(iocEnrichments)
      .where(and(eq(iocEnrichments.projectId, ctx.project.id), eq(iocEnrichments.iocId, row.id)))
      .orderBy(desc(iocEnrichments.fetchedAt))
      .limit(50);

    const jobs = await db
      .select({
        id: iocEnrichmentJobs.id,
        provider: iocEnrichmentJobs.provider,
        status: iocEnrichmentJobs.status,
        attemptCount: iocEnrichmentJobs.attemptCount,
        startedAt: iocEnrichmentJobs.startedAt,
        finishedAt: iocEnrichmentJobs.finishedAt,
        error: iocEnrichmentJobs.error,
        createdAt: iocEnrichmentJobs.createdAt,
        updatedAt: iocEnrichmentJobs.updatedAt,
      })
      .from(iocEnrichmentJobs)
      .where(and(eq(iocEnrichmentJobs.projectId, ctx.project.id), eq(iocEnrichmentJobs.iocId, row.id)))
      .orderBy(desc(iocEnrichmentJobs.createdAt))
      .limit(50);

    return json({ ok: true, ioc: row, sources, enrichments, jobs });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const p = await params;
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "IOC management is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const tagsInput = Array.isArray(body?.tags) ? body.tags : null;
  if (!tagsInput) return json({ error: "tags must be an array" }, { status: 400 });

  const tags = tagsInput
    .map((t: any) => String(t ?? "").trim())
    .filter((t: string) => t.length > 0 && t.length <= 64)
    .slice(0, 50);

  const now = new Date();

  try {
    const [row] = await db
      .update(iocs)
      .set({ tags, updatedAt: now })
      .where(and(eq(iocs.projectId, ctx.project.id), eq(iocs.id, p.id)))
      .returning({
        id: iocs.id,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
        tags: iocs.tags,
        firstSeenAt: iocs.firstSeenAt,
        lastSeenAt: iocs.lastSeenAt,
        createdAt: iocs.createdAt,
        updatedAt: iocs.updatedAt,
      });

    if (!row) return json({ error: "IOC not found" }, { status: 404 });
    return json({ ok: true, ioc: row });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const p = await params;
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "IOC management is available on Pro." }, { status: 403 });

  try {
    const [row] = await db
      .delete(iocs)
      .where(and(eq(iocs.projectId, ctx.project.id), eq(iocs.id, p.id)))
      .returning({ id: iocs.id });
    if (!row) return json({ error: "IOC not found" }, { status: 404 });
    return json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
