export const runtime = "edge";

import { getDb, tabletopExercises, tabletopInjects, tabletopRoles } from "@ti/db";
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

function splitFacilitatorAndAar(text: string) {
  const s = String(text ?? "");
  const marker = "\n\nAAR Template\n\n";
  const i = s.indexOf(marker);
  if (i < 0) return { facilitatorGuide: s, aarTemplate: "" };
  return { facilitatorGuide: s.slice(0, i).trim(), aarTemplate: s.slice(i + marker.length).trim() };
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
      .select()
      .from(tabletopInjects)
      .where(eq(tabletopInjects.exerciseId, exerciseId))
      .orderBy(asc(tabletopInjects.sequence))
      .limit(50);

    const roles = await db
      .select()
      .from(tabletopRoles)
      .where(eq(tabletopRoles.exerciseId, exerciseId))
      .orderBy(asc(tabletopRoles.roleName))
      .limit(50);

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // US Letter
    const pageHeight = 792;
    const margin = 54;
    const lineGap = 3;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const addLine = (text: string, size = 12, bold = false, color = rgb(0.12, 0.12, 0.12)) => {
      const f = bold ? fontBold : font;
      page.drawText(text, { x: margin, y, size, font: f, color });
      y -= size + lineGap;
    };

    const wrap = (text: string, size = 12) => {
      const maxWidth = pageWidth - margin * 2;
      const words = String(text ?? "").replace(/\r/g, "").split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        const width = font.widthOfTextAtSize(next, size);
        if (width <= maxWidth) {
          cur = next;
          continue;
        }
        if (cur) lines.push(cur);
        cur = w;
      }
      if (cur) lines.push(cur);
      return lines;
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
    };

    addLine(exercise.title, 22, true);
    addLine(`Actor: ${exercise.actorName}`, 12);
    addLine(`Scenario: ${exercise.scenarioType} | Difficulty: ${exercise.difficultyLevel} | Duration: ${exercise.durationMinutes}m`, 12);
    if (exercise.complianceTag) addLine(`Compliance: ${exercise.complianceTag}`, 12);
    y -= 10;

    const section = (title: string) => {
      ensureSpace(30);
      addLine(title, 16, true);
      y -= 4;
    };

    section("Narrative");
    for (const line of wrap(exercise.narrative.slice(0, 50_000), 11)) {
      ensureSpace(16);
      addLine(line, 11, false, rgb(0.18, 0.18, 0.18));
    }
    y -= 10;

    section("Injects");
    for (const inj of injects.slice(0, 10)) {
      ensureSpace(40);
      addLine(`#${inj.sequence} — T+${inj.tPlusMinutes}m — ${inj.title}`, 13, true);
      if (inj.attackTechniqueId) addLine(`Technique: ${inj.attackTechniqueId}`, 10, false, rgb(0.35, 0.35, 0.35));
      for (const line of wrap(inj.situation.slice(0, 10_000), 11)) {
        ensureSpace(16);
        addLine(line, 11, false, rgb(0.18, 0.18, 0.18));
      }
      y -= 6;
    }
    y -= 6;

    section("Roles");
    for (const r of roles.slice(0, 12)) {
      ensureSpace(30);
      addLine(r.roleName, 13, true);
      for (const line of wrap(r.briefing.slice(0, 4_000), 11)) {
        ensureSpace(16);
        addLine(line, 11, false, rgb(0.18, 0.18, 0.18));
      }
      y -= 6;
    }
    y -= 6;

    const split = splitFacilitatorAndAar(exercise.facilitatorGuide);
    section("Facilitator guide");
    for (const line of wrap(split.facilitatorGuide.slice(0, 30_000), 11)) {
      ensureSpace(16);
      addLine(line, 11, false, rgb(0.18, 0.18, 0.18));
    }
    y -= 10;

    if (split.aarTemplate) {
      section("AAR template");
      for (const line of wrap(split.aarTemplate.slice(0, 20_000), 11)) {
        ensureSpace(16);
        addLine(line, 11, false, rgb(0.18, 0.18, 0.18));
      }
    }

    const bytes = await pdf.save();
    const fileName = `${safeFileName(exercise.title)}.pdf`;

    // Ensure we return an ArrayBuffer (not a SharedArrayBuffer-backed view) for edge Response compatibility.
    const body = new Uint8Array(bytes).buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    if (isMissingTable(err)) return new Response("Tabletop tables are missing. Run pnpm db:migrate.", { status: 503 });
    throw err;
  }
}
