/**
 * SourceReliabilityAgent — backfills document→source attribution (optional)
 * and computes source reliability scores/snapshots.
 *
 * Run:
 *  - pnpm run:source-reliability
 *  - pnpm run:source-reliability -- --backfill
 *  - pnpm run:source-reliability -- --backfill --dry-run
 */

import "../lib/env.js";
import { documents, getDb, sources } from "@ti/db";
import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { computeAndPersistSourceReliability } from "../lib/source-reliability.js";

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function backfillDocumentSourceIds(params: { limit: number; dryRun: boolean }) {
  const db = getDb();

  // 1) Exact URL match (covers STIX doc URL and any sources that are stored as docs verbatim).
  if (!params.dryRun) {
    try {
      await (db as any).execute(sql`
        UPDATE documents d
        SET source_id = s.id
        FROM sources s
        WHERE d.source_id IS NULL
          AND d.url = s.url
      `);
    } catch (err) {
      const code = String((err as any)?.code ?? "");
      if (code !== "42P01" && code !== "42703") throw err;
      return { ok: false as const, reason: "db_not_ready", updated: 0, scanned: 0 };
    }
  }

  // 2) Hostname heuristic for RSS-fed documents.
  const sourceRows = await db
    .select({ id: sources.id, url: sources.url })
    .from(sources)
    .limit(5000);

  const hostToSourceId = new Map<string, string | null>();
  for (const s of sourceRows) {
    const host = hostnameFromUrl(s.url);
    if (!host) continue;
    const existing = hostToSourceId.get(host);
    if (!existing) hostToSourceId.set(host, s.id);
    else if (existing !== s.id) hostToSourceId.set(host, null); // ambiguous
  }

  const docs = await db
    .select({ id: documents.id, url: documents.url })
    .from(documents)
    .where(isNull(documents.sourceId))
    .orderBy(desc(documents.fetchedAt))
    .limit(params.limit);

  const idsBySource = new Map<string, string[]>();
  for (const d of docs) {
    const host = hostnameFromUrl(d.url);
    if (!host) continue;
    const sourceId = hostToSourceId.get(host);
    if (!sourceId) continue;
    const list = idsBySource.get(sourceId) ?? [];
    list.push(d.id);
    idsBySource.set(sourceId, list);
  }

  let updated = 0;
  if (!params.dryRun) {
    for (const [sourceId, ids] of idsBySource.entries()) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db.update(documents).set({ sourceId }).where(inArray(documents.id, chunk));
        updated += chunk.length;
      }
    }
  } else {
    for (const ids of idsBySource.values()) updated += ids.length;
  }

  return { ok: true as const, scanned: docs.length, updated };
}

export async function runSourceReliabilityAgent() {
  const doBackfill = process.argv.includes("--backfill");
  const dryRun = process.argv.includes("--dry-run");
  const limit = Math.max(100, Number(process.env["SOURCE_RELIABILITY_BACKFILL_LIMIT"] ?? "5000") || 5000);

  if (doBackfill) {
    console.log(`[SourceReliabilityAgent] Backfill starting (limit=${limit}, dryRun=${dryRun})...`);
    const res = await backfillDocumentSourceIds({ limit, dryRun });
    if (res.ok) {
      console.log(
        `[SourceReliabilityAgent] Backfill done. scanned=${res.scanned} updated=${res.updated}${dryRun ? " (dry-run)" : ""}`
      );
    } else {
      console.log(`[SourceReliabilityAgent] Backfill skipped (${res.reason}).`);
    }
  }

  console.log("[SourceReliabilityAgent] Computing reliability...");
  const out = await computeAndPersistSourceReliability();
  if (out.ok) {
    console.log(`[SourceReliabilityAgent] Done. snapshots=${out.computed} sourcesUpdated=${out.updated}`);
  } else {
    console.log(`[SourceReliabilityAgent] Skipped (${out.reason}).`);
  }
}

if (process.argv[1]?.endsWith("source-reliability.ts")) {
  runSourceReliabilityAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

