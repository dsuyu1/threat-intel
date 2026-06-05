/**
 * VulnAgent — fetches CVEs from NVD + CISA KEV, summarizes with AI,
 * and upserts into the findings table.
 *
 * Run:  pnpm run:vuln
 * Cron: every 6 hours via AWS EventBridge or Cloudflare Cron
 */

import "../lib/env.js";
import crypto from "node:crypto";
import { getDb, findings, kgEntities } from "@ti/db";
import { sql } from "drizzle-orm";
import { summarizeVuln } from "../lib/ai.js";

// ─── NVD Types ────────────────────────────────────────────────────────────────

interface NvdCveItem {
  cve: {
    id: string;
    published: string;
    descriptions: { lang: string; value: string }[];
    metrics?: {
      cvssMetricV31?: {
        cvssData: { baseScore: number; vectorString: string };
        baseSeverity: string;
      }[];
      cvssMetricV2?: {
        cvssData: { baseScore: number; vectorString: string };
        baseSeverity: string;
      }[];
    };
    references: { url: string; source: string }[];
  };
}

interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: NvdCveItem[];
}

// ─── CISA KEV Types ───────────────────────────────────────────────────────────

interface KevVuln {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
}

interface KevCatalog {
  vulnerabilities: KevVuln[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupHash(agent: string, key: string): string {
  return crypto.createHash("sha256").update(`${agent}:${key}`).digest("hex");
}

function nvdSeverityToEnum(
  s: string
): "critical" | "high" | "medium" | "low" | "info" {
  const map: Record<string, "critical" | "high" | "medium" | "low"> = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
  };
  return map[s.toUpperCase()] ?? "info";
}

function pickFirstSentence(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.{20,240}?)(?:\. |\.$|; |$)/);
  return (m?.[1] ?? t).trim();
}

function cveDisplayName(params: { cveId: string; kevName?: string | null; nvdDescription?: string | null }) {
  const kev = String(params.kevName ?? "").trim();
  if (kev) return kev.slice(0, 180);
  const s = pickFirstSentence(params.nvdDescription ?? "");
  if (s) return s.slice(0, 180);
  return params.cveId;
}

// ─── NVD Fetcher ──────────────────────────────────────────────────────────────

async function fetchRecentCves(hoursBack = 8): Promise<NvdCveItem[]> {
  const apiKey = process.env["NVD_API_KEY"];
  const pubEndDate = new Date();
  const pubStartDate = new Date(
    pubEndDate.getTime() - hoursBack * 60 * 60 * 1000
  );

  const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, ".000");

  const params = new URLSearchParams({
    pubStartDate: fmt(pubStartDate),
    pubEndDate: fmt(pubEndDate),
    resultsPerPage: "100",
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) headers["apiKey"] = apiKey;

  const res = await fetch(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`NVD API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as NvdResponse;
  return data.vulnerabilities;
}

// ─── CISA KEV Fetcher ─────────────────────────────────────────────────────────

async function fetchKevCatalog(): Promise<KevVuln[]> {
  const res = await fetch(
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
  );
  if (!res.ok) throw new Error(`CISA KEV error: ${res.status}`);
  const data = (await res.json()) as KevCatalog;
  return data.vulnerabilities;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runVulnAgent() {
  console.log("[VulnAgent] Starting...");
  const db = getDb();

  // 1. Fetch from both sources in parallel
  const [nvdItems, kevItems] = await Promise.all([
    fetchRecentCves(8),
    fetchKevCatalog(),
  ]);

  // Build a KEV lookup for quick cross-reference
  const kevMap = new Map(kevItems.map((k) => [k.cveID, k]));

  console.log(
    `[VulnAgent] NVD: ${nvdItems.length} CVEs | KEV catalog: ${kevItems.length} entries`
  );

  let inserted = 0;
  let skipped = 0;

  for (const item of nvdItems) {
    const cve = item.cve;
    const cveId = cve.id;
    const hash = dedupHash("vuln", cveId);

    // Extract CVSS
    const metric =
      cve.metrics?.cvssMetricV31?.[0] ?? cve.metrics?.cvssMetricV2?.[0];
    const cvssScore = metric?.cvssData.baseScore?.toString() ?? null;
    const cvssVector = metric?.cvssData.vectorString ?? null;
    const rawSeverity = metric?.baseSeverity ?? null;
    const severity = rawSeverity ? nvdSeverityToEnum(rawSeverity) : null;

    // English description
    const description =
      cve.descriptions.find((d) => d.lang === "en")?.value ?? cveId;

    // Is this in CISA KEV? (means it's being actively exploited)
    const kev = kevMap.get(cveId);
    const tags = kev
      ? JSON.stringify(["kev", "actively-exploited", kev.vendorProject])
      : null;

    // AI summary (skip if no description or low-value)
    let summary: string | null = null;
    try {
      summary = await summarizeVuln({
        cveId,
        description,
        cvssScore: cvssScore ? parseFloat(cvssScore) : null,
        severity,
        isKev: !!kev,
        kevAction: kev?.requiredAction,
      });
    } catch (err) {
      console.warn(`[VulnAgent] AI summary failed for ${cveId}:`, err);
    }

    // Enrich / upsert CVE entity (used by Actor Explorer pages).
    try {
      const displayName = cveDisplayName({
        cveId,
        kevName: kev?.vulnerabilityName ?? null,
        nvdDescription: description,
      });

      const now = new Date();
      await db
        .insert(kgEntities)
        .values({
          kind: "cve",
          entityId: cveId,
          name: displayName,
          aliases: null,
          description: summary ?? description,
          attributes: {
            nvd: {
              url: `https://nvd.nist.gov/vuln/detail/${cveId}`,
              publishedAt: cve.published,
              references: (cve.references ?? []).slice(0, 8).map((r) => ({ url: r.url, source: r.source })),
            },
            kev: kev
              ? {
                  vendorProject: kev.vendorProject,
                  product: kev.product,
                  vulnerabilityName: kev.vulnerabilityName,
                  dateAdded: kev.dateAdded,
                  dueDate: kev.dueDate,
                  requiredAction: kev.requiredAction,
                }
              : null,
            cvss: {
              score: metric?.cvssData?.baseScore ?? null,
              vector: metric?.cvssData?.vectorString ?? null,
              severity: rawSeverity ?? null,
            },
            updatedBy: { agent: "vuln", at: now.toISOString() },
          } as never,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [kgEntities.kind, kgEntities.entityId],
          set: {
            name: sql`excluded.name`,
            description: sql`COALESCE(${kgEntities.description}, excluded.description)`,
            attributes: sql`COALESCE(${kgEntities.attributes}, '{}'::jsonb) || excluded.attributes`,
            updatedAt: now,
          },
        });
    } catch (err) {
      console.warn(`[VulnAgent] CVE entity upsert failed for ${cveId}:`, err);
    }

    // Upsert (ignore on conflict — dedup_hash is unique)
    try {
      await db
        .insert(findings)
        .values({
          agent: "vuln",
          title: kev?.vulnerabilityName ?? `${cveId} — ${description.slice(0, 120)}`,
          summary,
          rawData: JSON.stringify(cve),
          severity: severity ?? undefined,
          cvssScore: cvssScore ?? undefined,
          cvssVector: cvssVector ?? undefined,
          cveId,
          tags,
          sourceUrl: `https://nvd.nist.gov/vuln/detail/${cveId}`,
          sourceTitle: "NVD",
          dedupHash: hash,
          publishedAt: new Date(cve.published),
        })
        .onConflictDoNothing();
      inserted++;
    } catch {
      skipped++;
    }
  }

  console.log(
    `[VulnAgent] Done. Inserted: ${inserted} | Skipped (already exists): ${skipped}`
  );
}

// Run directly
if (process.argv[1]?.endsWith("vuln.ts")) {
  runVulnAgent().catch(console.error);
}
