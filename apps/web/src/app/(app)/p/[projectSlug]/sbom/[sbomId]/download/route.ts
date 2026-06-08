export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, sboms } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  if (code === "42P01") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('relation "') && msg.includes("does not exist");
}

export async function GET(_req: Request, ctx: { params: Promise<{ projectSlug: string; sbomId: string }> }) {
  const p = await ctx.params;
  const viewer = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return new Response("Forbidden", { status: 403 });

  const db = getDb();

  let row: { name: string; document: any } | undefined;
  try {
    [row] = await db
      .select({ name: sboms.name, document: sboms.document })
      .from(sboms)
      .where(and(eq(sboms.id, p.sbomId), eq(sboms.projectId, viewer.project.id)))
      .limit(1);
  } catch (err) {
    if (isMissingTable(err)) return new Response("SBOM tables are missing. Run pnpm db:migrate.", { status: 503 });
    throw err;
  }

  if (!row) return new Response("Not found", { status: 404 });

  const filename = (row.name || "sbom.json").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new Response(JSON.stringify(row.document, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
