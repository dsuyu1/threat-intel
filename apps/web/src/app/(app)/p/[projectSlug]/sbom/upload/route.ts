export const runtime = "edge";
export const dynamic = "force-dynamic";

import { findings, getDb, sboms } from "@ti/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sha256Hex } from "../../../../../../lib/api-keys";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { analyzeSbom } from "../../../../../../lib/sbom";
import { getViewerContext } from "../../../../../../lib/tenancy";

function textResponse(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  if (code === "42P01") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('relation "') && msg.includes("does not exist");
}

export async function POST(req: Request, ctx: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await ctx.params;
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return textResponse("SBOM correlation is available on Pro.", 403);

  const form = await req.formData().catch(() => null);
  if (!form) return textResponse("Invalid form data");

  const file = form.get("file");
  if (!file || typeof file === "string") return textResponse("file is required");

  const name = String((file as any).name ?? "sbom.json");
  const size = Number((file as any).size ?? 0);
  if (!Number.isFinite(size) || size <= 0) return textResponse("Empty upload");
  if (size > 2_000_000) return textResponse("SBOM too large (max 2MB).");

  const raw = await (file as File).text();
  let doc: unknown = null;
  try {
    doc = JSON.parse(raw);
  } catch {
    return textResponse("Only JSON SBOMs are supported right now (CycloneDX/SPDX JSON).");
  }

  const sha256 = await sha256Hex(raw);
  const analysis = analyzeSbom(doc);

  const cves = new Set<string>();
  for (const set of analysis.cvesByComponentRef.values()) {
    for (const cve of set) cves.add(cve);
  }
  const cveIds = Array.from(cves).slice(0, 2000);

  const db = getDb();

  let matchedCveCount = 0;
  if (cveIds.length) {
    const rows = await db
      .select({ cveId: findings.cveId })
      .from(findings)
      .where(and(inArray(findings.cveId, cveIds), sql`${findings.cveId} is not null`))
      .groupBy(findings.cveId)
      .limit(5000);
    matchedCveCount = rows.length;
  }

  const vulnerableComponentCount = Array.from(analysis.cvesByComponentRef.values()).filter((s) => s.size > 0).length;

  const now = new Date();

  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(sboms)
      .values({
        projectId: viewer.project.id,
        userId: viewer.user.id,
        name,
        format: analysis.format,
        sha256,
        document: doc as any,
        componentCount: analysis.components.length,
        vulnerableComponentCount,
        matchedCveCount,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: sboms.id });
  } catch (err) {
    if (isMissingTable(err)) return textResponse("SBOM tables are missing. Run pnpm db:migrate.", 503);
    throw err;
  }

  let sbomId = created?.id ?? null;
  if (!sbomId) {
    let existing: { id: string } | undefined;
    try {
      [existing] = await db
        .select({ id: sboms.id })
        .from(sboms)
        .where(and(eq(sboms.projectId, viewer.project.id), eq(sboms.sha256, sha256)))
        .limit(1);
    } catch (err) {
      if (isMissingTable(err)) return textResponse("SBOM tables are missing. Run pnpm db:migrate.", 503);
      throw err;
    }
    sbomId = existing?.id ?? null;
  }

  if (!sbomId) return textResponse("Failed to store SBOM", 500);

  const redirectTo = new URL(`/p/${encodeURIComponent(projectSlug)}/sbom/${encodeURIComponent(sbomId)}`, req.url);
  return Response.redirect(redirectTo, 303);
}
