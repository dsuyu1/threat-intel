export const runtime = "edge";

import { getDb, navigatorDetectionJobs, navigatorScenarios } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

type DetectionFormat = "sigma" | "kql" | "spl";
const FORMATS: DetectionFormat[] = ["sigma", "kql", "spl"];

function normalizeFormats(input: unknown): DetectionFormat[] {
  const arr = Array.isArray(input) ? input : null;
  if (!arr) return [...FORMATS];
  const out: DetectionFormat[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!(FORMATS as readonly string[]).includes(s)) continue;
    if (!out.includes(s as DetectionFormat)) out.push(s as DetectionFormat);
  }
  return out.length ? out : [...FORMATS];
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Navigator is available on Pro." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as any;
  const scenarioId = String(body?.scenarioId ?? "").trim();
  const techniqueId = String(body?.techniqueId ?? "").trim();
  const formats = normalizeFormats(body?.formats);

  if (!scenarioId) return json({ error: "scenarioId is required" }, { status: 400 });
  if (!techniqueId) return json({ error: "techniqueId is required" }, { status: 400 });

  const [scenario] = await db
    .select({
      id: navigatorScenarios.id,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, scenarioId), eq(navigatorScenarios.projectId, ctx.project.id)))
    .limit(1);

  if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });
  if (scenario.targetKind !== "technique") return json({ error: "Detections can only be generated for technique scenarios." }, { status: 409 });
  if (String(scenario.targetId) !== techniqueId) return json({ error: "techniqueId does not match scenario targetId" }, { status: 400 });

  try {
    const now = new Date();
    await db.insert(navigatorDetectionJobs).values({
      projectId: ctx.project.id,
      userId: ctx.user.id,
      scenarioId,
      techniqueId,
      formats,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    return json({ ok: true, queued: true, formats });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Detections tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

