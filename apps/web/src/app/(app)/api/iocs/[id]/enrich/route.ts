export const runtime = "edge";

import { getDb, iocEnrichments, iocEnrichmentJobs, iocEnrichmentKeys, iocs } from "@ti/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

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

function normalizeProvider(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "virustotal" || s === "shodan") return s as "virustotal" | "shodan";
  return null;
}

export async function POST(
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
  const provider = normalizeProvider(body?.provider);
  if (!provider) return json({ error: "provider must be virustotal or shodan" }, { status: 400 });
  const force = body?.force === true;

  const now = new Date();

  try {
    const [iocRow] = await db
      .select({ id: iocs.id })
      .from(iocs)
      .where(and(eq(iocs.projectId, ctx.project.id), eq(iocs.id, p.id)))
      .limit(1);
    if (!iocRow) return json({ error: "IOC not found" }, { status: 404 });

    const [keyRow] = await db
      .select({ enabled: iocEnrichmentKeys.enabled })
      .from(iocEnrichmentKeys)
      .where(and(eq(iocEnrichmentKeys.projectId, ctx.project.id), eq(iocEnrichmentKeys.provider, provider)))
      .limit(1);
    if (!keyRow?.enabled) return json({ error: `No enabled ${provider} key configured for this project.` }, { status: 400 });

    if (!force) {
      const [fresh] = await db
        .select({
          id: iocEnrichments.id,
          fetchedAt: iocEnrichments.fetchedAt,
          expiresAt: iocEnrichments.expiresAt,
          error: iocEnrichments.error,
        })
        .from(iocEnrichments)
        .where(and(eq(iocEnrichments.projectId, ctx.project.id), eq(iocEnrichments.iocId, p.id), eq(iocEnrichments.provider, provider), isNotNull(iocEnrichments.expiresAt)))
        .orderBy(desc(iocEnrichments.fetchedAt))
        .limit(1);

      if (fresh?.expiresAt && fresh.expiresAt.getTime() > now.getTime()) {
        return json({ ok: true, skipped: true, enrichment: fresh });
      }
    }

    try {
      const [job] = await db
        .insert(iocEnrichmentJobs)
        .values({
          projectId: ctx.project.id,
          iocId: p.id,
          provider,
          status: "queued",
          requestedByUserId: ctx.user.id,
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: iocEnrichmentJobs.id,
          status: iocEnrichmentJobs.status,
          provider: iocEnrichmentJobs.provider,
          createdAt: iocEnrichmentJobs.createdAt,
        });

      return json({ ok: true, queued: true, job });
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code !== "23505") throw err;
      const [existing] = await db
        .select({
          id: iocEnrichmentJobs.id,
          status: iocEnrichmentJobs.status,
          provider: iocEnrichmentJobs.provider,
          createdAt: iocEnrichmentJobs.createdAt,
          updatedAt: iocEnrichmentJobs.updatedAt,
        })
        .from(iocEnrichmentJobs)
        .where(
          and(
            eq(iocEnrichmentJobs.projectId, ctx.project.id),
            eq(iocEnrichmentJobs.iocId, p.id),
            eq(iocEnrichmentJobs.provider, provider),
            inArray(iocEnrichmentJobs.status, ["queued", "running"])
          )
        )
        .orderBy(desc(iocEnrichmentJobs.createdAt))
        .limit(1);
      return json({ ok: true, queued: false, job: existing ?? null });
    }
  } catch (err) {
    if (isMissingTable(err)) return json({ error: "IOC tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
