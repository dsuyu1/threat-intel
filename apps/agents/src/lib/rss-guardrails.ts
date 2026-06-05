export const DEFAULT_NEW_FEED_BACKFILL_DAYS = 30;
export const DEFAULT_MAX_NEW_DOCS_PER_RUN = 50;

export function isNewFeed(lastFetchedAt: Date | null | undefined) {
  return !lastFetchedAt;
}

export function getBackfillCutoff(now: Date, backfillDays = DEFAULT_NEW_FEED_BACKFILL_DAYS) {
  const ms = Math.max(0, Math.floor(backfillDays)) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

export function shouldIngestRssItem(params: {
  sourceLastFetchedAt: Date | null | undefined;
  itemPublishedAt: Date | null;
  now: Date;
  backfillDays?: number;
}) {
  if (!isNewFeed(params.sourceLastFetchedAt)) return true;
  const cutoff = getBackfillCutoff(
    params.now,
    params.backfillDays ?? DEFAULT_NEW_FEED_BACKFILL_DAYS
  );
  if (!params.itemPublishedAt) return false;
  return params.itemPublishedAt.getTime() >= cutoff.getTime();
}

export function parseMaxNewDocsPerRun(
  env: Record<string, string | undefined> = process.env
): number | null {
  const raw = env["ATTACK_AGENT_MAX_NEW_DOCS_PER_RUN"];
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_NEW_DOCS_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_NEW_DOCS_PER_RUN;
  const i = Math.floor(n);
  if (i <= 0) return null;
  return i;
}

export class NewDocBudget {
  readonly maxNewDocs: number | null;
  usedNewDocs = 0;

  constructor(maxNewDocs: number | null) {
    this.maxNewDocs = maxNewDocs;
  }

  canConsumeNewDoc() {
    if (this.maxNewDocs == null) return true;
    return this.usedNewDocs < this.maxNewDocs;
  }

  consumeNewDoc() {
    if (!this.canConsumeNewDoc()) return false;
    this.usedNewDocs += 1;
    return true;
  }
}

