export const runtime = "nodejs";

import { getDb, tabletopExercises, tabletopInjects } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const code = String((err as any)?.code ?? "");
  return code === "42P01";
}

function safeFileName(s: string) {
  const base = String(s ?? "tabletop").trim() || "tabletop";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "tabletop";
}

function truncate(s: string, max = 1200) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

async function toArrayBuffer(v: unknown): Promise<ArrayBuffer> {
  if (v instanceof ArrayBuffer) return v;
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  if (typeof Blob !== "undefined" && v instanceof Blob) return await v.arrayBuffer();
  if (typeof v === "string") {
    // base64 or binarystring; not expected in our config
    throw new Error("Unexpected PPTX output type");
  }
  throw new Error("Unexpected PPTX output type");
}

export async function GET(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return new Response("Tabletop exercises are available on Pro.", { status: 403 });

  const { id } = await ctx2.params;
  const exerciseId = String(id ?? "").trim();
  if (!exerciseId) return new Response("Missing id", { status: 400 });

  try {
    const [exercise] = await db
      .select()
      .from(tabletopExercises)
      .where(and(eq(tabletopExercises.id, exerciseId), eq(tabletopExercises.projectId, viewer.project.id)))
      .limit(1);
    if (!exercise) return new Response("Not found", { status: 404 });

    const injects = await db
      .select({
        sequence: tabletopInjects.sequence,
        tPlusMinutes: tabletopInjects.tPlusMinutes,
        title: tabletopInjects.title,
        situation: tabletopInjects.situation,
        attackTechniqueId: tabletopInjects.attackTechniqueId,
      })
      .from(tabletopInjects)
      .where(eq(tabletopInjects.exerciseId, exerciseId))
      .orderBy(asc(tabletopInjects.sequence))
      .limit(50);

    const mod: any = await import("pptxgenjs");
    const PptxGenJS = mod?.default ?? mod;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Threat Intel Platform";
    pptx.title = exercise.title;

    const titleSlide = pptx.addSlide();
    titleSlide.addText(exercise.title, { x: 0.7, y: 1.0, w: 12.0, h: 1.2, fontSize: 34, bold: true });
    titleSlide.addText(`Actor: ${exercise.actorName}`, { x: 0.7, y: 2.4, w: 12.0, h: 0.6, fontSize: 18 });
    titleSlide.addText(
      `Scenario: ${exercise.scenarioType} | Difficulty: ${exercise.difficultyLevel} | Duration: ${exercise.durationMinutes}m`,
      { x: 0.7, y: 3.1, w: 12.0, h: 0.6, fontSize: 14, color: "666666" }
    );
    if (exercise.complianceTag) {
      titleSlide.addText(`Compliance: ${exercise.complianceTag}`, { x: 0.7, y: 3.7, w: 12.0, h: 0.6, fontSize: 14, color: "666666" });
    }

    const narrativeSlide = pptx.addSlide();
    narrativeSlide.addText("Narrative", { x: 0.7, y: 0.6, w: 12.0, h: 0.6, fontSize: 24, bold: true });
    narrativeSlide.addText(truncate(exercise.narrative, 2200), { x: 0.7, y: 1.4, w: 12.0, h: 5.4, fontSize: 14, valign: "top" });

    for (const inj of injects.slice(0, 12)) {
      const s = pptx.addSlide();
      s.addText(`Inject #${inj.sequence} — T+${inj.tPlusMinutes}m`, { x: 0.7, y: 0.5, w: 12.0, h: 0.5, fontSize: 14, color: "666666" });
      s.addText(truncate(inj.title, 90), { x: 0.7, y: 1.0, w: 12.0, h: 0.8, fontSize: 26, bold: true });
      if (inj.attackTechniqueId) {
        s.addText(`Technique: ${inj.attackTechniqueId}`, { x: 0.7, y: 1.85, w: 12.0, h: 0.4, fontSize: 12, color: "666666" });
      }
      s.addText(truncate(inj.situation, 2600), { x: 0.7, y: 2.35, w: 12.0, h: 4.9, fontSize: 14, valign: "top" });
    }

    const close = pptx.addSlide();
    close.addText("Next steps", { x: 0.7, y: 0.8, w: 12.0, h: 0.7, fontSize: 26, bold: true });
    close.addText(
      "1) Capture gaps as findings\n2) Link to Navigator scenarios\n3) Assign owners and due dates\n4) Re-run in 30–60 days",
      { x: 0.9, y: 1.8, w: 12.0, h: 2.2, fontSize: 16, valign: "top" }
    );

    const out = await pptx.write({ outputType: "arraybuffer" });
    const bytes = await toArrayBuffer(out);
    const fileName = `${safeFileName(exercise.title)}.pptx`;

    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    if (isMissingTable(err)) return new Response("Tabletop tables are missing. Run pnpm db:migrate.", { status: 503 });
    throw err;
  }
}
