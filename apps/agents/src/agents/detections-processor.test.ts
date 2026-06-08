import { describe, expect, it } from "vitest";

import { runDetectionsQueueProcessor } from "./detections-processor.js";

describe("Detections queue processor", () => {
  it("processes a queued job and upserts detections", async () => {
    const calls: string[] = [];
    const jobs = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        projectId: "p1",
        userId: "u1",
        scenarioId: "s1",
        techniqueId: "T1059",
        formats: ["sigma", "kql", "spl"],
      },
    ];

    const res = await runDetectionsQueueProcessor({
      maxJobs: 10,
      deps: {
        now: () => new Date("2026-06-07T12:00:00Z"),
        getModel: () => "test-model",
        stripCodeFences: (t) => t.replace(/^```[a-z0-9_-]*\s*/i, "").replace(/\s*```$/i, ""),
        dequeueJob: async () => jobs.shift() ?? null,
        markRunning: async (id) => calls.push(`running:${id}`),
        markSucceeded: async (id) => calls.push(`succeeded:${id}`),
        markFailed: async (id, e) => calls.push(`failed:${id}:${e}`),
        buildPrompt: async ({ format }) => ({ prompt: `prompt:${format}`, techniqueName: "Technique" }),
        generateText: async ({ prompt }) => `\`\`\`\n${prompt}\n\`\`\``,
        upsertDetection: async ({ format, content }) => calls.push(`upsert:${format}:${content}`),
      },
    });

    expect(res.jobs).toBe(1);
    expect(res.detections).toBe(3);
    expect(calls).toContain("running:11111111-1111-1111-1111-111111111111");
    expect(calls).toContain("succeeded:11111111-1111-1111-1111-111111111111");
    expect(calls.filter((c) => c.startsWith("upsert:")).length).toBe(3);
  });

  it("marks a job failed when generation throws", async () => {
    const calls: string[] = [];
    const jobs = [
      {
        id: "22222222-2222-2222-2222-222222222222",
        projectId: "p1",
        userId: "u1",
        scenarioId: "s1",
        techniqueId: "T1059",
        formats: ["spl"],
      },
    ];

    const res = await runDetectionsQueueProcessor({
      maxJobs: 10,
      deps: {
        now: () => new Date("2026-06-07T12:00:00Z"),
        getModel: () => "test-model",
        stripCodeFences: (t) => t,
        dequeueJob: async () => jobs.shift() ?? null,
        markRunning: async (id) => calls.push(`running:${id}`),
        markSucceeded: async (id) => calls.push(`succeeded:${id}`),
        markFailed: async (id, e) => calls.push(`failed:${id}:${e}`),
        buildPrompt: async () => ({ prompt: "prompt", techniqueName: "Technique" }),
        generateText: async () => {
          throw new Error("boom");
        },
        upsertDetection: async () => calls.push("upsert"),
      },
    });

    expect(res.jobs).toBe(1);
    expect(res.detections).toBe(0);
    expect(calls.some((c) => c.startsWith("failed:22222222-2222-2222-2222-222222222222"))).toBe(true);
    expect(calls.some((c) => c.startsWith("succeeded:"))).toBe(false);
    expect(calls).not.toContain("upsert");
  });
});

