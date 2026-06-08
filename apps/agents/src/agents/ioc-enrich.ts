/**
 * IocEnrichAgent — drains queued IOC enrichment jobs and stores provider output.
 *
 * Providers:
 * - VirusTotal (ip/domain/url/file hash)
 * - Shodan (ip)
 *
 * Notes:
 * - Uses per-project encrypted API keys stored in `ioc_enrichment_keys`.
 * - Writes latest provider response into `ioc_enrichments` (upsert per ioc+provider).
 *
 * Run: pnpm run:agents -- --agentKey ioc-enrich ...
 * Cron: scheduled (serverless.yml)
 */

import "../lib/env.js";
import { decryptSecret } from "../lib/secretbox.js";
import { getDb, iocEnrichments, iocEnrichmentJobs, iocEnrichmentKeys, iocs } from "@ti/db";
import { and, asc, eq, sql } from "drizzle-orm";

type Provider = "virustotal" | "shodan";

function base64url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400 * 1000);
}

function truncate(s: string, max = 2000) {
  const x = String(s ?? "");
  return x.length > max ? `${x.slice(0, max)}…` : x;
}

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function fetchVirustotal(params: { apiKey: string; kind: string; normalized: string }) {
  const base = "https://www.virustotal.com/api/v3";
  const kind = params.kind;
  let url = "";
  if (kind === "ipv4" || kind === "ipv6") url = `${base}/ip_addresses/${encodeURIComponent(params.normalized)}`;
  else if (kind === "domain") url = `${base}/domains/${encodeURIComponent(params.normalized)}`;
  else if (kind === "url") url = `${base}/urls/${encodeURIComponent(base64url(params.normalized))}`;
  else if (kind === "md5" || kind === "sha1" || kind === "sha256") url = `${base}/files/${encodeURIComponent(params.normalized)}`;
  else throw new Error(`VirusTotal does not support kind: ${kind}`);

  return fetchJson(url, { method: "GET", headers: { accept: "application/json", "x-apikey": params.apiKey } });
}

async function fetchShodan(params: { apiKey: string; kind: string; normalized: string }) {
  const kind = params.kind;
  if (kind !== "ipv4" && kind !== "ipv6") throw new Error(`Shodan does not support kind: ${kind}`);
  const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(params.normalized)}?key=${encodeURIComponent(params.apiKey)}`;
  return fetchJson(url, { method: "GET", headers: { accept: "application/json" } });
}

async function loadApiKey(params: { projectId: string; provider: Provider }) {
  const db = getDb();
  const [row] = await db
    .select({ apiKeyEnc: iocEnrichmentKeys.apiKeyEnc })
    .from(iocEnrichmentKeys)
    .where(and(eq(iocEnrichmentKeys.projectId, params.projectId), eq(iocEnrichmentKeys.provider, params.provider), eq(iocEnrichmentKeys.enabled, true)))
    .limit(1);
  if (!row?.apiKeyEnc) throw new Error(`No enabled ${params.provider} key configured for project.`);
  return decryptSecret(row.apiKeyEnc);
}

export async function runIocEnrichAgent(opts?: { limit?: number; maxAttempts?: number }) {
  const db = getDb();
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 25)));
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(opts?.maxAttempts ?? 3)));

  const queued = await db
    .select({
      id: iocEnrichmentJobs.id,
      projectId: iocEnrichmentJobs.projectId,
      iocId: iocEnrichmentJobs.iocId,
      provider: iocEnrichmentJobs.provider,
      attemptCount: iocEnrichmentJobs.attemptCount,
      createdAt: iocEnrichmentJobs.createdAt,
    })
    .from(iocEnrichmentJobs)
    .where(sql`${iocEnrichmentJobs.status} = 'queued' and ${iocEnrichmentJobs.attemptCount} < ${maxAttempts}`)
    .orderBy(asc(iocEnrichmentJobs.createdAt))
    .limit(limit);

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of queued) {
    const now = new Date();
    const [take] = await db
      .update(iocEnrichmentJobs)
      .set({
        status: "running" as any,
        startedAt: now,
        attemptCount: sql`${iocEnrichmentJobs.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(and(eq(iocEnrichmentJobs.id, job.id), eq(iocEnrichmentJobs.status, "queued" as any)))
      .returning({ id: iocEnrichmentJobs.id });

    if (!take?.id) continue;
    claimed++;

    try {
      const [ioc] = await db
        .select({ kind: iocs.kind, normalized: iocs.normalized })
        .from(iocs)
        .where(and(eq(iocs.projectId, job.projectId), eq(iocs.id, job.iocId)))
        .limit(1);

      if (!ioc) throw new Error("IOC missing");

      const provider = job.provider as Provider;
      const apiKey = await loadApiKey({ projectId: job.projectId, provider });

      const result =
        provider === "virustotal"
          ? await fetchVirustotal({ apiKey, kind: String(ioc.kind), normalized: String(ioc.normalized) })
          : await fetchShodan({ apiKey, kind: String(ioc.kind), normalized: String(ioc.normalized) });

      const expiresAt = addDays(now, provider === "virustotal" ? 7 : 7);

      await db
        .insert(iocEnrichments)
        .values({
          projectId: job.projectId,
          iocId: job.iocId,
          provider,
          fetchedAt: now,
          expiresAt,
          rawJson: result.ok ? (result.json as any) : (result.json as any),
          error: result.ok ? null : `HTTP ${result.status}: ${truncate(result.text, 500)}`,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [iocEnrichments.iocId, iocEnrichments.provider],
          set: {
            fetchedAt: now,
            expiresAt,
            rawJson: sql`excluded.raw_json`,
            error: sql`excluded.error`,
            updatedAt: now,
          },
        });

      await db
        .update(iocEnrichmentJobs)
        .set({ status: "succeeded" as any, finishedAt: now, error: null, updatedAt: now })
        .where(eq(iocEnrichmentJobs.id, job.id));

      succeeded++;
    } catch (err) {
      const message = truncate(String((err as any)?.message ?? err ?? "Unknown error"), 2000);
      await db
        .update(iocEnrichmentJobs)
        .set({ status: "failed" as any, finishedAt: now, error: message, updatedAt: now })
        .where(eq(iocEnrichmentJobs.id, job.id));
      failed++;
    }
  }

  return { jobsClaimed: claimed, jobsSucceeded: succeeded, jobsFailed: failed };
}

