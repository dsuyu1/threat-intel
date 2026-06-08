/**
 * DetectionsAgent — drains navigator_detection_jobs and generates cached detections.
 *
 * Run: pnpm run:detections
 * Cron: frequent (queue drain)
 */

import "../lib/env.js";

import { buildNavigatorDetectionPrompt, getDb, navigatorDetectionJobs, navigatorDetections, stripCodeFences } from "@ti/db";
import { and, asc, eq } from "drizzle-orm";
import { getChatModel, generateText } from "../lib/openai.js";
import { runDetectionsQueueProcessor } from "./detections-processor.js";

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  const msg = String(anyErr?.message ?? err ?? "Unknown error");
  return msg.replace(/sk-[a-z0-9]{20,}/gi, "sk-***").slice(0, 2000);
}

type Args = { scenarioId: string | null };

function parseArgs(argv: string[]): Args {
  const out: Args = { scenarioId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scenarioId") out.scenarioId = String(argv[++i] ?? "").trim() || null;
  }
  return out;
}

export async function runDetectionsAgent(params?: { scenarioId?: string | null }) {
  console.log("[DetectionsAgent] Starting...");
  const db = getDb();
  const scenarioId = params?.scenarioId ? String(params.scenarioId).trim() : null;

  const res = await runDetectionsQueueProcessor({
    maxJobs: 10,
    deps: {
      now: () => new Date(),
      getModel: () => getChatModel(),
      stripCodeFences,
      buildPrompt: async (p) => {
        return buildNavigatorDetectionPrompt({
          db,
          projectId: p.projectId,
          scenarioId: p.scenarioId,
          techniqueId: p.techniqueId,
          format: p.format,
          sigmaRuleId: p.sigmaRuleId,
          date: p.date,
        });
      },
      generateText: async ({ prompt }) => {
        return generateText({ prompt, temperature: 0.15, maxTokens: 1100 });
      },
      dequeueJob: async () => {
        const where = scenarioId
          ? and(eq(navigatorDetectionJobs.status, "queued"), eq(navigatorDetectionJobs.scenarioId, scenarioId))
          : eq(navigatorDetectionJobs.status, "queued");

        const [next] = await db
          .select({
            id: navigatorDetectionJobs.id,
            projectId: navigatorDetectionJobs.projectId,
            userId: navigatorDetectionJobs.userId,
            scenarioId: navigatorDetectionJobs.scenarioId,
            techniqueId: navigatorDetectionJobs.techniqueId,
            formats: navigatorDetectionJobs.formats,
          })
          .from(navigatorDetectionJobs)
          .where(where)
          .orderBy(asc(navigatorDetectionJobs.createdAt))
          .limit(1);

        if (!next) return null;

        const now = new Date();
        const [claimed] = await db
          .update(navigatorDetectionJobs)
          .set({ status: "running", error: null, updatedAt: now })
          .where(and(eq(navigatorDetectionJobs.id, next.id), eq(navigatorDetectionJobs.status, "queued")))
          .returning({ id: navigatorDetectionJobs.id });

        if (!claimed) return null;
        return next;
      },
      markRunning: async (_jobId) => {
        // No-op: dequeue already claims + sets running atomically.
      },
      markSucceeded: async (jobId) => {
        const now = new Date();
        await db
          .update(navigatorDetectionJobs)
          .set({ status: "succeeded", error: null, updatedAt: now })
          .where(eq(navigatorDetectionJobs.id, jobId));
      },
      markFailed: async (jobId, error) => {
        const now = new Date();
        await db
          .update(navigatorDetectionJobs)
          .set({ status: "failed", error: String(error ?? "").slice(0, 2000), updatedAt: now })
          .where(eq(navigatorDetectionJobs.id, jobId));
      },
      upsertDetection: async (d) => {
        const now = new Date();
        await db
          .insert(navigatorDetections)
          .values({
            projectId: d.projectId,
            userId: d.userId,
            scenarioId: d.scenarioId,
            techniqueId: d.techniqueId,
            techniqueName: d.techniqueName,
            format: d.format,
            content: d.content,
            model: d.model,
            lifecycleStatus: "draft",
            reviewedAt: null,
            reviewedBy: null,
            deployedAt: null,
            retiredAt: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              navigatorDetections.projectId,
              navigatorDetections.scenarioId,
              navigatorDetections.techniqueId,
              navigatorDetections.format,
            ],
            set: {
              userId: d.userId,
              techniqueName: d.techniqueName,
              content: d.content,
              model: d.model,
              lifecycleStatus: "draft",
              reviewedAt: null,
              reviewedBy: null,
              deployedAt: null,
              retiredAt: null,
              updatedAt: now,
            },
          });
      },
    },
  });

  console.log(`[DetectionsAgent] Done. Jobs: ${res.jobs} | Detections: ${res.detections}`);
}

if (process.argv[1]?.endsWith("detections.ts")) {
  const args = parseArgs(process.argv.slice(2));
  runDetectionsAgent({ scenarioId: args.scenarioId }).catch((err) => {
    console.error(safeErrorMessage(err));
    process.exitCode = 1;
  });
}
