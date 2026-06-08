/**
 * TheHiveSyncAgent — polls TheHive cases and upserts incident lifecycle data.
 *
 * Run:  pnpm run:thehive
 * Cron: every 15 minutes via AWS EventBridge
 */

import "../lib/env.js";
import { and, eq, sql } from "drizzle-orm";
import { getDb, incidents, thehiveConnections } from "@ti/db";
import { decryptSecret } from "../lib/secretbox.js";
import { mapTheHiveCaseToIncident } from "../lib/thehive.js";

type TheHiveConnectionRow = {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  authScheme: string;
  apiKeyEnc: string;
  lastSyncedAt: Date | null;
};

async function postQuery(baseUrl: string, apiKey: string, query: unknown) {
  const url = `${baseUrl}/api/v1/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(query),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`TheHive query failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractCaseArray(payload: unknown): any[] | null {
  if (Array.isArray(payload)) return payload as any[];
  if (payload && typeof payload === "object") {
    const p = payload as any;
    if (Array.isArray(p.data)) return p.data;
    if (Array.isArray(p.result)) return p.result;
    if (Array.isArray(p.results)) return p.results;
    if (Array.isArray(p.cases)) return p.cases;
  }
  return null;
}

async function fetchCasesPage(params: { baseUrl: string; apiKey: string; from: number; to: number }) {
  const variants: unknown[] = [
    [{ _name: "listCase" }, { _name: "sort", _fields: [{ _updatedAt: "desc" }] }, { _name: "page", from: params.from, to: params.to }],
    [{ _name: "listCase" }, { _name: "sort", _fields: [{ updatedAt: "desc" }] }, { _name: "page", from: params.from, to: params.to }],
    [{ _name: "listCase" }, { _name: "page", from: params.from, to: params.to }],
  ];

  let lastErr: unknown = null;
  for (const q of variants) {
    try {
      const payload = await postQuery(params.baseUrl, params.apiKey, q);
      const arr = extractCaseArray(payload);
      if (arr) return arr;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch cases from TheHive");
}

function computeSince(lastSyncedAt: Date | null) {
  const now = new Date();
  if (lastSyncedAt) return new Date(lastSyncedAt.getTime() - 60 * 60 * 1000); // 1h safety buffer
  return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // default: 90d backfill
}

export async function runTheHiveSyncAgent(): Promise<{
  connectionsProcessed: number;
  casesSeen: number;
  incidentsUpserted: number;
}> {
  const db = getDb();

  const connections: TheHiveConnectionRow[] = await db
    .select({
      id: thehiveConnections.id,
      projectId: thehiveConnections.projectId,
      name: thehiveConnections.name,
      baseUrl: thehiveConnections.baseUrl,
      authScheme: thehiveConnections.authScheme,
      apiKeyEnc: thehiveConnections.apiKeyEnc,
      lastSyncedAt: thehiveConnections.lastSyncedAt,
    })
    .from(thehiveConnections)
    .where(eq(thehiveConnections.enabled, true));

  if (!connections.length) {
    console.log("[TheHiveSyncAgent] No enabled connections.");
    return { connectionsProcessed: 0, casesSeen: 0, incidentsUpserted: 0 };
  }

  let casesSeen = 0;
  let incidentsUpserted = 0;

  for (const c of connections) {
    console.log(`[TheHiveSyncAgent] Syncing: ${c.name} (${c.baseUrl})`);

    let apiKey: string;
    try {
      apiKey = await decryptSecret(c.apiKeyEnc);
    } catch (err) {
      console.warn(`[TheHiveSyncAgent] Failed to decrypt API key for ${c.name}:`, err);
      continue;
    }

    if (String(c.authScheme ?? "bearer").toLowerCase() !== "bearer") {
      console.warn(`[TheHiveSyncAgent] Unsupported authScheme for ${c.name}: ${c.authScheme}`);
      continue;
    }

    const since = computeSince(c.lastSyncedAt);
    const now = new Date();

    const pageSize = 100;
    const maxPages = 40; // cap to avoid unbounded runs
    let stoppedEarly = false;

    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize;

      let cases: any[];
      try {
        cases = await fetchCasesPage({ baseUrl: c.baseUrl, apiKey, from, to });
      } catch (err) {
        console.warn(`[TheHiveSyncAgent] Fetch failed for ${c.name} (page ${page}):`, err);
        break;
      }

      if (!cases.length) break;
      casesSeen += cases.length;

      let minUpdatedAt: number | null = null;

      for (const raw of cases) {
        const mapped = mapTheHiveCaseToIncident(raw);
        if (!mapped) continue;

        const updatedAt = mapped.externalUpdatedAt?.getTime() ?? null;
        if (updatedAt != null) minUpdatedAt = minUpdatedAt == null ? updatedAt : Math.min(minUpdatedAt, updatedAt);

        const changedAt = mapped.externalUpdatedAt ?? mapped.detectedAt ?? null;
        if (changedAt && changedAt.getTime() < since.getTime()) continue;

        try {
          await db
            .insert(incidents)
            .values({
              projectId: c.projectId,
              source: "thehive",
              externalId: mapped.externalId,
              externalNumber: mapped.externalNumber ?? undefined,
              title: mapped.title ?? undefined,
              status: mapped.status ?? undefined,
              incidentType: mapped.incidentType ?? undefined,
              startedAt: mapped.startedAt ?? undefined,
              detectedAt: mapped.detectedAt ?? undefined,
              respondedAt: mapped.respondedAt ?? undefined,
              containedAt: mapped.containedAt ?? undefined,
              closedAt: mapped.closedAt ?? undefined,
              externalUpdatedAt: mapped.externalUpdatedAt ?? undefined,
              rawJson: mapped.rawJson as any,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [incidents.projectId, incidents.source, incidents.externalId],
              set: {
                externalNumber: mapped.externalNumber ?? undefined,
                title: mapped.title ?? undefined,
                status: mapped.status ?? undefined,
                incidentType: mapped.incidentType ?? undefined,
                startedAt: mapped.startedAt ?? undefined,
                detectedAt: mapped.detectedAt ?? undefined,
                respondedAt: mapped.respondedAt ?? undefined,
                containedAt: mapped.containedAt ?? undefined,
                closedAt: mapped.closedAt ?? undefined,
                externalUpdatedAt: mapped.externalUpdatedAt ?? undefined,
                rawJson: mapped.rawJson as any,
                updatedAt: now,
              },
            });

          incidentsUpserted++;
        } catch (err) {
          console.warn(`[TheHiveSyncAgent] Upsert failed for case ${mapped.externalId}:`, err);
        }
      }

      // If TheHive returns sorted by updatedAt desc, this stops once the page is fully older than our buffer window.
      if (minUpdatedAt != null && minUpdatedAt < since.getTime()) {
        stoppedEarly = true;
        break;
      }
    }

    try {
      await db
        .update(thehiveConnections)
        .set({ lastSyncedAt: now, updatedAt: now })
        .where(and(eq(thehiveConnections.id, c.id), eq(thehiveConnections.projectId, c.projectId)));
    } catch (err) {
      console.warn(`[TheHiveSyncAgent] Failed to update lastSyncedAt for ${c.name}:`, err);
    }

    console.log(
      `[TheHiveSyncAgent] Done: ${c.name} (since=${since.toISOString()})` +
        (stoppedEarly ? " [stopped early]" : "")
    );
  }

  const [{ countConnections }] = await db
    .select({ countConnections: sql<number>`count(*)` })
    .from(thehiveConnections)
    .where(eq(thehiveConnections.enabled, true));

  return {
    connectionsProcessed: Number(countConnections ?? 0),
    casesSeen,
    incidentsUpserted,
  };
}

if (process.argv[1]?.endsWith("thehive.ts")) {
  runTheHiveSyncAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

