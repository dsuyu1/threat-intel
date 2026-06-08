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

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

    const heading = (text: string, level: any) =>
      new Paragraph({ text, heading: level });

    const para = (text: string) =>
      new Paragraph({ children: [new TextRun({ text })] });

    const doc = new Document({
      sections: [
        {
          children: [
            heading(exercise.title, HeadingLevel.TITLE),
            para(`Actor: ${exercise.actorName}`),
            para(`Scenario: ${exercise.scenarioType} | Difficulty: ${exercise.difficultyLevel} | Duration: ${exercise.durationMinutes} minutes`),
            exercise.complianceTag ? para(`Compliance tag: ${exercise.complianceTag}`) : para(""),

            heading("Narrative", HeadingLevel.HEADING_1),
            para(exercise.narrative.slice(0, 50_000)),

            heading("Injects", HeadingLevel.HEADING_1),
            ...injects.flatMap((inj) => [
              heading(`#${inj.sequence} – T+${inj.tPlusMinutes}m – ${inj.title}`, HeadingLevel.HEADING_2),
              inj.attackTechniqueId ? para(`Technique: ${inj.attackTechniqueId}`) : para(""),
              para(inj.situation.slice(0, 20_000)),
              para("Discussion questions:"),
              ...((inj.discussionQuestions ?? []) as any[]).slice(0, 12).map((q) => para(`• ${String(q)}`)),
              para("Evaluation criteria:"),
              ...((inj.evaluationCriteria ?? []) as any[]).slice(0, 12).map((c) => para(`• ${String(c)}`)),
              inj.curveballs && (inj.curveballs as any[]).length ? para("Curveballs:") : para(""),
              ...(inj.curveballs && (inj.curveballs as any[]).length
                ? (inj.curveballs as any[]).slice(0, 8).map((cb) => para(`• ${String(cb)}`))
                : []),
              inj.facilitatorTips ? para(`Facilitator tips: ${inj.facilitatorTips}`) : para(""),
              para(""),
            ]),

            heading("Roles", HeadingLevel.HEADING_1),
            ...roles.flatMap((r) => [
              heading(r.roleName, HeadingLevel.HEADING_2),
              para(r.briefing.slice(0, 10_000)),
              para("Responsibilities:"),
              ...((r.keyResponsibilities ?? []) as any[]).slice(0, 12).map((x) => para(`• ${String(x)}`)),
              para("Documents to have:"),
              ...((r.documentsToHave ?? []) as any[]).slice(0, 12).map((x) => para(`• ${String(x)}`)),
              para(""),
            ]),

            heading("Facilitator guide", HeadingLevel.HEADING_1),
            para(exercise.facilitatorGuide.slice(0, 80_000)),
          ],
        },
      ],
    });

    const blob: Blob = await (Packer as any).toBlob(doc);
    const bytes = await blob.arrayBuffer();
    const fileName = `${safeFileName(exercise.title)}.docx`;

    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    if (isMissingTable(err)) return new Response("Tabletop tables are missing. Run pnpm db:migrate.", { status: 503 });
    throw err;
  }
}
