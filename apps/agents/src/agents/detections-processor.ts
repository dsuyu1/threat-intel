import type { NavigatorDetectionFormat } from "@ti/db";

export type DetectionJobLike = {
  id: string;
  projectId: string;
  userId: string;
  scenarioId: string;
  techniqueId: string;
  formats: unknown;
};

export function normalizeJobFormats(formats: unknown): NavigatorDetectionFormat[] {
  const allowed = new Set<NavigatorDetectionFormat>(["sigma", "kql", "spl"]);
  const arr = Array.isArray(formats) ? formats : [];
  const out: NavigatorDetectionFormat[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase() as NavigatorDetectionFormat;
    if (!allowed.has(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out.length ? out : ["sigma", "kql", "spl"];
}

export type DetectionsProcessorDeps = {
  dequeueJob: () => Promise<DetectionJobLike | null>;
  markRunning: (jobId: string) => Promise<void>;
  markSucceeded: (jobId: string) => Promise<void>;
  markFailed: (jobId: string, error: string) => Promise<void>;
  upsertDetection: (params: {
    projectId: string;
    userId: string;
    scenarioId: string;
    techniqueId: string;
    techniqueName: string;
    format: NavigatorDetectionFormat;
    content: string;
    model: string | null;
  }) => Promise<void>;
  buildPrompt: (params: {
    projectId: string;
    scenarioId: string;
    techniqueId: string;
    format: NavigatorDetectionFormat;
    sigmaRuleId: string;
    date: string;
  }) => Promise<{ prompt: string; techniqueName: string }>;
  generateText: (params: { prompt: string }) => Promise<string>;
  stripCodeFences: (text: string) => string;
  getModel: () => string | null;
  now: () => Date;
};

export async function runDetectionsQueueProcessor(params: {
  deps: DetectionsProcessorDeps;
  maxJobs?: number;
}): Promise<{ jobs: number; detections: number }> {
  const maxJobs = Math.max(1, params.maxJobs ?? 10);
  let jobs = 0;
  let detections = 0;

  for (let i = 0; i < maxJobs; i++) {
    const job = await params.deps.dequeueJob();
    if (!job) break;
    jobs++;

    await params.deps.markRunning(job.id);

    try {
      const formats = normalizeJobFormats(job.formats);
      const date = params.deps.now().toISOString().slice(0, 10);

      for (const format of formats) {
        const sigmaRuleId = job.id;
        const built = await params.deps.buildPrompt({
          projectId: job.projectId,
          scenarioId: job.scenarioId,
          techniqueId: job.techniqueId,
          format,
          sigmaRuleId,
          date,
        });

        let content = await params.deps.generateText({ prompt: built.prompt });
        content = params.deps.stripCodeFences(content);

        await params.deps.upsertDetection({
          projectId: job.projectId,
          userId: job.userId,
          scenarioId: job.scenarioId,
          techniqueId: job.techniqueId,
          techniqueName: built.techniqueName,
          format,
          content,
          model: params.deps.getModel(),
        });
        detections++;
      }

      await params.deps.markSucceeded(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await params.deps.markFailed(job.id, msg);
    }
  }

  return { jobs, detections };
}
