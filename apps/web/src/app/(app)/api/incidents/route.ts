export const runtime = "edge";

import { getDb, incidents } from "@ti/db";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { getViewerContext } from "../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  let ctx: Awaited<ReturnType<typeof getViewerContext>>;
  try {
    ctx = await getViewerContext({ projectSlug });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const onlyClosed = url.searchParams.get("closed") === "1";

  try {
    const where = onlyClosed
      ? and(eq(incidents.projectId, ctx.project.id), or(isNotNull(incidents.closedAt), isNotNull(incidents.containedAt)))
      : eq(incidents.projectId, ctx.project.id);

    const rows = await db
      .select({
        id: incidents.id,
        title: incidents.title,
        status: incidents.status,
        incidentType: incidents.incidentType,
        externalId: incidents.externalId,
        externalNumber: incidents.externalNumber,
        detectedAt: incidents.detectedAt,
        containedAt: incidents.containedAt,
        closedAt: incidents.closedAt,
      })
      .from(incidents)
      .where(where)
      .orderBy(desc(incidents.detectedAt), desc(incidents.updatedAt))
      .limit(250);

    return json({ ok: true, incidents: rows });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Incident tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
