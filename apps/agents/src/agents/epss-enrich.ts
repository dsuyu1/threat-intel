/**
 * EpssEnrichAgent — nightly enrichment for findings with CVEs.
 *
 * Fetches EPSS (FIRST) probability-of-exploitation scores and stores them on findings.
 *
 * Run: pnpm run:epss-enrich
 * Cron: daily (serverless.yml)
 */

import "../lib/env.js";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { findings, getDb } from "@ti/db";

type EpssRecord = {
  cve?: string;
  epss?: string | number;
  percentile?: string | number;
  date?: string;
};

type EpssResponse = {
  status?: string;
  data?: EpssRecord[];
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function isValidCveId(cveId: string) {
  return /^CVE-\d{4}-\d{4,}$/i.test(cveId);
}

function toNumericString(v: unknown): string | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

async function fetchEpssBatch(cveIds: string[]): Promise<Map<string, { epss: string | null; percentile: string | null }>> {
  const out = new Map<string, { epss: string | null; percentile: string | null }>();
  const ids = cveIds.filter((c) => isValidCveId(c)).map((c) => c.toUpperCase());
  if (!ids.length) return out;

  const url = `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(ids.join(","))}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`EPSS API error: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as EpssResponse;
  const rows = Array.isArray(json.data) ? json.data : [];
  for (const r of rows) {
    const cve = String(r.cve ?? "").trim().toUpperCase();
    if (!cve) continue;
    out.set(cve, { epss: toNumericString(r.epss), percentile: toNumericString(r.percentile) });
  }

  return out;
}

export async function runEpssEnrichAgent() {
  console.log("[EpssEnrichAgent] Starting...");
  const db = getDb();

  const maxPerRun = parseIntEnv("EPSS_ENRICH_MAX_PER_RUN", 1500);
  const batchSize = Math.max(1, Math.min(200, parseIntEnv("EPSS_ENRICH_BATCH_SIZE", 100)));
  const maxAgeHours = Math.max(1, Math.min(24 * 14, parseIntEnv("EPSS_ENRICH_MAX_AGE_HOURS", 26)));

  const staleBefore = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const rows = await db
    .select({ cveId: findings.cveId })
    .from(findings)
    .where(
      and(
        isNotNull(findings.cveId),
        or(isNull(findings.epssUpdatedAt), lt(findings.epssUpdatedAt, staleBefore))
      )
    )
    .groupBy(findings.cveId)
    .orderBy(sql`${findings.cveId} asc`)
    .limit(maxPerRun);

  const cveIds = rows
    .map((r) => String(r.cveId ?? "").trim())
    .filter(Boolean)
    .filter(isValidCveId)
    .map((c) => c.toUpperCase());

  console.log(`[EpssEnrichAgent] Candidates: ${cveIds.length} (limit ${maxPerRun})`);
  if (!cveIds.length) return;

  let updatedCves = 0;
  let updatedRows = 0;
  let failedBatches = 0;

  for (const batch of chunk(cveIds, batchSize)) {
    let map: Map<string, { epss: string | null; percentile: string | null }>;
    try {
      map = await fetchEpssBatch(batch);
    } catch (err) {
      failedBatches += 1;
      console.warn("[EpssEnrichAgent] Batch fetch failed:", err);
      continue;
    }

    const now = new Date();

    for (const cveId of batch) {
      const hit = map.get(cveId) ?? null;
      const patch: Record<string, any> = {
        epssUpdatedAt: now,
      };
      if (hit?.epss != null) patch.epssScore = hit.epss;
      if (hit?.percentile != null) patch.epssPercentile = hit.percentile;

      const res = await db
        .update(findings)
        .set(patch)
        .where(eq(findings.cveId, cveId))
        .returning({ id: findings.id });

      if (res.length) {
        updatedCves += 1;
        updatedRows += res.length;
      }
    }
  }

  console.log(
    `[EpssEnrichAgent] Done. Updated CVEs: ${updatedCves} | Updated rows: ${updatedRows} | Failed batches: ${failedBatches}`
  );
}

if (process.argv[1]?.endsWith("epss-enrich.ts")) {
  runEpssEnrichAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
