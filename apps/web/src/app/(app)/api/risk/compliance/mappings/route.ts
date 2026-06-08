export const runtime = "edge";

import { complianceMappings, getDb } from "@ti/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const FRAMEWORK = new Set(["nist_csf_2", "cis_v8", "iso_27001"]);
const SOURCE_KIND = new Set(["mitigation", "technique", "scenario"]);

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Risk management is available on Pro." }, { status: 403 });

  try {
    const counts = await db
      .select({
        framework: complianceMappings.framework,
        count: sql<number>`count(*)`,
      })
      .from(complianceMappings)
      .where(eq(complianceMappings.projectId, viewer.project.id))
      .groupBy(complianceMappings.framework)
      .orderBy(asc(complianceMappings.framework))
      .limit(10);

    const recent = await db
      .select({
        id: complianceMappings.id,
        framework: complianceMappings.framework,
        sourceKind: complianceMappings.sourceKind,
        sourceId: complianceMappings.sourceId,
        controlId: complianceMappings.controlId,
        controlTitle: complianceMappings.controlTitle,
        updatedAt: complianceMappings.updatedAt,
      })
      .from(complianceMappings)
      .where(eq(complianceMappings.projectId, viewer.project.id))
      .orderBy(desc(complianceMappings.updatedAt))
      .limit(50);

    return json({
      ok: true,
      counts: counts.map((c) => ({ framework: String(c.framework), count: Number(c.count ?? 0) })),
      recent: recent.map((r) => ({
        id: r.id,
        framework: String(r.framework),
        sourceKind: String(r.sourceKind),
        sourceId: String(r.sourceId),
        controlId: String(r.controlId),
        controlTitle: r.controlTitle ? String(r.controlTitle) : null,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Compliance tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Risk management is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const items = Array.isArray(body?.items) ? (body.items as any[]) : [];
  if (!items.length) return json({ error: "items is required" }, { status: 400 });

  const now = new Date();
  const rows: Array<{
    projectId: string;
    userId: string;
    framework: any;
    sourceKind: any;
    sourceId: string;
    controlId: string;
    controlTitle?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  for (const it of items.slice(0, 500)) {
    const framework = String(it?.framework ?? "").trim();
    const sourceKind = String(it?.sourceKind ?? "").trim();
    const sourceId = String(it?.sourceId ?? "").trim();
    const controlId = String(it?.controlId ?? "").trim();
    const controlTitle = it?.controlTitle != null ? String(it.controlTitle).trim() : null;

    if (!FRAMEWORK.has(framework)) continue;
    if (!SOURCE_KIND.has(sourceKind)) continue;
    if (!sourceId || !controlId) continue;

    rows.push({
      projectId: viewer.project.id,
      userId: viewer.user.id,
      framework: framework as any,
      sourceKind: sourceKind as any,
      sourceId,
      controlId,
      controlTitle: controlTitle ? controlTitle.slice(0, 200) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!rows.length) return json({ error: "No valid items to import" }, { status: 400 });

  try {
    await db.insert(complianceMappings).values(rows as any).onConflictDoNothing();
    return json({ ok: true, imported: rows.length });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") return json({ error: "Compliance tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}
