import { getDb, sources, sourceReliabilitySnapshots } from "@ti/db";
import { eq, sql } from "drizzle-orm";

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function safeRate(numer: number, denom: number) {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0) return 0;
  return numer / denom;
}

export type ReliabilityComputeOptions = {
  windowDays?: number;
  maturityDays?: number;
  minClaims?: number;
  timelinessDecayHours?: number;
  weights?: { confirmation: number; timeliness: number; falsePositivePenalty: number };
};

export async function computeAndPersistSourceReliability(
  opts: ReliabilityComputeOptions = {}
) {
  const windowDays = Math.max(1, Math.floor(opts.windowDays ?? 90));
  const maturityDays = Math.max(1, Math.floor(opts.maturityDays ?? 14));
  const minClaims = Math.max(1, Math.floor(opts.minClaims ?? 25));
  const timelinessDecayHours = Math.max(1, Number(opts.timelinessDecayHours ?? 72));
  const weights = opts.weights ?? {
    confirmation: 0.45,
    timeliness: 0.35,
    falsePositivePenalty: 0.2,
  };

  const db = getDb();
  const computedAt = new Date();

  type MetricRow = {
    sourceId: string;
    totalClaims: number;
    confirmedClaims: number;
    avgDelayHours: number | null;
    timelinessScore: number | null;
    maturedClaims: number;
    unconfirmedMatured: number;
  };

  let metrics: MetricRow[] = [];
  try {
    const res: any = await (db as any).execute(sql`
      WITH evidence_times AS (
        SELECT
          d.source_id AS source_id,
          e.relation_id AS relation_id,
          MIN(COALESCE(e.published_at, d.published_at, d.fetched_at, e.created_at)) AS source_first_time
        FROM kg_evidence e
        INNER JOIN documents d ON d.id = e.document_id
        WHERE d.source_id IS NOT NULL
          AND COALESCE(e.published_at, d.published_at, d.fetched_at, e.created_at) >= now() - (${windowDays} * interval '1 day')
        GROUP BY d.source_id, e.relation_id
      ),
      relation_global AS (
        SELECT
          relation_id,
          MIN(source_first_time) AS global_first_time,
          COUNT(*) AS source_count
        FROM evidence_times
        GROUP BY relation_id
      )
      SELECT
        et.source_id AS "sourceId",
        COUNT(*)::int AS "totalClaims",
        COUNT(*) FILTER (WHERE rg.source_count >= 2)::int AS "confirmedClaims",
        AVG(EXTRACT(EPOCH FROM (et.source_first_time - rg.global_first_time)) / 3600.0) AS "avgDelayHours",
        AVG(EXP(-(EXTRACT(EPOCH FROM (et.source_first_time - rg.global_first_time)) / 3600.0) / ${timelinessDecayHours})) AS "timelinessScore",
        COUNT(*) FILTER (WHERE rg.global_first_time <= now() - (${maturityDays} * interval '1 day'))::int AS "maturedClaims",
        COUNT(*) FILTER (WHERE rg.global_first_time <= now() - (${maturityDays} * interval '1 day') AND rg.source_count = 1)::int AS "unconfirmedMatured"
      FROM evidence_times et
      INNER JOIN relation_global rg ON rg.relation_id = et.relation_id
      GROUP BY et.source_id
    `);

    const rows = (Array.isArray(res) ? res : res?.rows ?? res?.result ?? []) as any[];
    metrics = rows.map((r) => ({
      sourceId: String(r.sourceId),
      totalClaims: Number(r.totalClaims ?? 0),
      confirmedClaims: Number(r.confirmedClaims ?? 0),
      avgDelayHours: r.avgDelayHours == null ? null : Number(r.avgDelayHours),
      timelinessScore: r.timelinessScore == null ? null : Number(r.timelinessScore),
      maturedClaims: Number(r.maturedClaims ?? 0),
      unconfirmedMatured: Number(r.unconfirmedMatured ?? 0),
    }));
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01" || code === "42703") {
      // Undefined table/column — migrations not applied yet.
      return { ok: false, reason: "db_not_ready", updated: 0, computed: 0 };
    }
    throw err;
  }

  if (metrics.length === 0) {
    return { ok: true, updated: 0, computed: 0 };
  }

  let updated = 0;
  let computed = 0;

  for (const m of metrics) {
    const [src] = await db
      .select({ reliability: sources.reliability })
      .from(sources)
      .where(eq(sources.id, m.sourceId))
      .limit(1);

    if (!src) continue;

    const totalClaims = Math.max(0, Math.floor(m.totalClaims ?? 0));
    const confirmedClaims = Math.max(0, Math.floor(m.confirmedClaims ?? 0));
    const confirmationRate = safeRate(confirmedClaims, totalClaims);

    const avgDelayHours = Number.isFinite(Number(m.avgDelayHours)) ? Number(m.avgDelayHours) : null;
    const timelinessScore = clamp01(Number.isFinite(Number(m.timelinessScore)) ? Number(m.timelinessScore) : 0);

    const maturedClaims = Math.max(0, Math.floor(m.maturedClaims ?? 0));
    const unconfirmedMatured = Math.max(0, Math.floor(m.unconfirmedMatured ?? 0));
    const falsePositiveRate = safeRate(unconfirmedMatured, maturedClaims);

    const computedReliability = clamp01(
      weights.confirmation * confirmationRate +
        weights.timeliness * timelinessScore +
        weights.falsePositivePenalty * (1 - falsePositiveRate)
    );

    const existingReliability = clamp01(Number(src.reliability ?? 0));
    const finalReliability = totalClaims < minClaims ? existingReliability : computedReliability;

    await db.insert(sourceReliabilitySnapshots).values({
      sourceId: m.sourceId,
      computedAt,
      windowDays,
      totalClaims,
      confirmedClaims,
      confirmationRate,
      avgDelayHours,
      timelinessScore,
      maturedClaims,
      falsePositiveRate,
      reliability: finalReliability,
    });

    computed += 1;

    if (totalClaims >= minClaims) {
      await db
        .update(sources)
        .set({ reliability: finalReliability, updatedAt: computedAt })
        .where(eq(sources.id, m.sourceId));
      updated += 1;
    }
  }

  return { ok: true, updated, computed };
}

