import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_NEW_DOCS_PER_RUN,
  DEFAULT_NEW_FEED_BACKFILL_DAYS,
  NewDocBudget,
  getBackfillCutoff,
  parseMaxNewDocsPerRun,
  shouldIngestRssItem,
} from "./rss-guardrails.js";

describe("rss-guardrails", () => {
  it("computes backfill cutoff", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    const cutoff = getBackfillCutoff(now, 30);
    expect(cutoff.toISOString()).toBe("2026-05-06T12:00:00.000Z");
  });

  it("limits new feeds to backfill window", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    const cutoff = getBackfillCutoff(now, DEFAULT_NEW_FEED_BACKFILL_DAYS);

    expect(
      shouldIngestRssItem({
        sourceLastFetchedAt: null,
        itemPublishedAt: null,
        now,
      })
    ).toBe(false);

    expect(
      shouldIngestRssItem({
        sourceLastFetchedAt: null,
        itemPublishedAt: new Date(cutoff.getTime() - 60_000),
        now,
      })
    ).toBe(false);

    expect(
      shouldIngestRssItem({
        sourceLastFetchedAt: null,
        itemPublishedAt: new Date(cutoff.getTime() + 60_000),
        now,
      })
    ).toBe(true);
  });

  it("does not limit existing feeds", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    expect(
      shouldIngestRssItem({
        sourceLastFetchedAt: new Date("2026-06-04T00:00:00Z"),
        itemPublishedAt: null,
        now,
      })
    ).toBe(true);
  });

  it("parses max-new-docs env with sensible defaults", () => {
    expect(parseMaxNewDocsPerRun({})).toBe(DEFAULT_MAX_NEW_DOCS_PER_RUN);
    expect(parseMaxNewDocsPerRun({ ATTACK_AGENT_MAX_NEW_DOCS_PER_RUN: "10" })).toBe(10);
    expect(parseMaxNewDocsPerRun({ ATTACK_AGENT_MAX_NEW_DOCS_PER_RUN: "0" })).toBeNull();
    expect(parseMaxNewDocsPerRun({ ATTACK_AGENT_MAX_NEW_DOCS_PER_RUN: "-1" })).toBeNull();
    expect(parseMaxNewDocsPerRun({ ATTACK_AGENT_MAX_NEW_DOCS_PER_RUN: "nope" })).toBe(
      DEFAULT_MAX_NEW_DOCS_PER_RUN
    );
  });

  it("enforces new-doc budget", () => {
    const b = new NewDocBudget(2);
    expect(b.consumeNewDoc()).toBe(true);
    expect(b.consumeNewDoc()).toBe(true);
    expect(b.consumeNewDoc()).toBe(false);
    expect(b.usedNewDocs).toBe(2);
  });
});

