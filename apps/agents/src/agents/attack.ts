/**
 * AttackAgent — ingests RSS reports, chunks + embeds, extracts actor/sector/ttp/cve
 * relationships with citations, and writes to the KG.
 *
 * Run: pnpm run:attack
 * Cron: every 4 hours (serverless.yml)
 */

import "../lib/env.js";
import crypto from "node:crypto";
import Parser from "rss-parser";
import { and, desc, eq } from "drizzle-orm";
import { getDb, docChunks, documents, sources, type Source } from "@ti/db";
import { embedTexts, generateText } from "../lib/openai.js";
import { chunkText, cleanHtmlToText } from "../lib/text.js";
import { ensureDefaultSources, getEnabledSources } from "../lib/sources.js";
import {
  ensureKgEntity,
  ensureKgEntityIfMissing,
  insertEvidence,
  resolveOrCreateActorByName,
  upsertRelationObservation,
} from "../lib/kg.js";

const SECTORS = [
  "finance",
  "healthcare",
  "government",
  "education",
  "energy",
  "telecom",
  "defense",
  "retail",
  "manufacturing",
  "technology",
  "transportation",
  "critical-infrastructure",
] as const;

type Sector = (typeof SECTORS)[number];

function isSector(x: string): x is Sector {
  return (SECTORS as readonly string[]).includes(x);
}

type Extraction = {
  actors: Array<{ name: string }>;
  origin_countries: Array<{
    actor: string;
    iso2: string;
    confidence: number;
    excerpt: string;
    chunk_index: number | null;
  }>;
  target_sectors: Array<{
    actor: string;
    sector: string;
    confidence: number;
    excerpt: string;
    chunk_index: number | null;
  }>;
  techniques: Array<{
    actor: string;
    technique: string;
    confidence: number;
    excerpt: string;
    chunk_index: number | null;
  }>;
  cves: Array<{
    actor: string;
    cve: string;
    confidence: number;
    excerpt: string;
    chunk_index: number | null;
  }>;
};

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = String(err);
  return /quota|resource_exhausted|rate limit|429/i.test(msg);
}

async function markDocumentError(docId: string, err: unknown): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({ status: "error", error: String(err).slice(0, 2000) })
    .where(eq(documents.id, docId));
}

async function extractFromChunks(params: {
  title: string;
  url: string;
  chunks: Array<{ index: number; text: string }>;
}): Promise<Extraction | null> {
  const chunkBlock = params.chunks
    .map((c) => `CHUNK ${c.index}:\n${c.text}`)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const prompt = `You are a threat intelligence analyst. Extract structured intel ONLY from the provided chunks.

Return STRICT JSON with these keys: actors, origin_countries, target_sectors, techniques, cves.

Rules:
- Use ISO2 for origin countries (e.g., RU, CN, IR, KP, US). If unknown, omit.
- target_sectors.sector MUST be one of: ${SECTORS.join(", ")}.
- techniques.technique MUST be an explicit ATT&CK ID like T1059 or T1059.001 (if not explicit, omit).
- cves.cve MUST match CVE-YYYY-NNNN (if not explicit, omit).
- Every record must include an excerpt quote (<= 200 chars) and chunk_index where that quote came from (or null if unclear).
- Do not invent facts. If the text is speculative, lower confidence.

 Title: ${params.title}
 URL: ${params.url}
 
 ${chunkBlock}`;

  const content = await generateText({
    prompt,
    temperature: 0.1,
    maxTokens: 900,
    jsonMode: true,
  });

  const parsed = safeJsonParse<Extraction>(content);
  if (!parsed) {
    console.warn("[AttackAgent] JSON parse failed (first 200 chars):", content.slice(0, 200));
  }
  return parsed;
}

async function upsertDocument(params: {
  url: string;
  title: string | null;
  publishedAt: Date | null;
  cleanText: string | null;
  status: "ok" | "error";
  error?: string | null;
}): Promise<string> {
  const db = getDb();
  const contentHash = crypto
    .createHash("sha256")
    .update(params.cleanText ?? params.error ?? params.url)
    .digest("hex");

  const inserted = await db
    .insert(documents)
    .values({
      url: params.url,
      title: params.title,
      publishedAt: params.publishedAt,
      contentHash,
      cleanText: params.cleanText,
      status: params.status,
      error: params.error ?? null,
    })
    .onConflictDoUpdate({
      target: [documents.url],
      set: {
        title: params.title,
        publishedAt: params.publishedAt,
        fetchedAt: new Date(),
        contentHash,
        cleanText: params.cleanText,
        status: params.status,
        error: params.error ?? null,
      },
    })
    .returning({ id: documents.id });

  if (inserted[0]?.id) return inserted[0].id;

  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.url, params.url))
    .limit(1);

  return existing[0]!.id;
}

export async function runAttackAgent() {
  console.log("[AttackAgent] Starting...");
  await ensureDefaultSources();
  const db = getDb();
  let disableAiForRun = false;

  const rssSources = await getEnabledSources("rss");
  const parser = new Parser();

  for (const src of rssSources) {
    console.log(`[AttackAgent] Feed: ${src.name} (${src.url})`);
    let feed: Parser.Output<unknown>;
    try {
      feed = await parser.parseURL(src.url);
    } catch (err) {
      console.warn("[AttackAgent] RSS parse failed:", err);
      continue;
    }

    for (const item of feed.items.slice(0, 20)) {
      const url = (item.link ?? "").trim();
      if (!url) continue;

      const title = (item.title ?? "").trim() || null;
      const publishedAt = item.pubDate ? new Date(item.pubDate) : null;

      const existing = await db
        .select({ id: documents.id, status: documents.status, cleanText: documents.cleanText })
        .from(documents)
        .where(eq(documents.url, url))
        .limit(1);
      const existingDoc = existing[0] ?? null;
      if (existingDoc?.status === "ok") continue;

      let html: string;
      let cleanText: string | null = existingDoc?.cleanText ?? null;

      try {
        if (!cleanText) {
          const res = await fetch(url, {
            headers: { "User-Agent": "threat-intel-platform/1.0" },
          });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          html = await res.text();
          cleanText = cleanHtmlToText(html).slice(0, 50_000);
        }
      } catch (err) {
        console.warn("[AttackAgent] Fetch failed:", url, err);
        const docId = await upsertDocument({
          url,
          title,
          publishedAt,
          cleanText: null,
          status: "error",
          error: String(err),
        });
        if (docId) {
          await markDocumentError(docId, err);
        }
        continue;
      }

      const docId = await upsertDocument({
        url,
        title,
        publishedAt,
        cleanText,
        status: "ok",
      });

      let chunks: Array<{ index: number; text: string }> = [];
      const chunkIdByIndex = new Map<number, string>();

      const existingChunks = await db
        .select({ id: docChunks.id, chunkIndex: docChunks.chunkIndex, chunkText: docChunks.chunkText })
        .from(docChunks)
        .where(eq(docChunks.documentId, docId))
        .orderBy(docChunks.chunkIndex);

      if (existingChunks.length > 0 && existingDoc?.cleanText) {
        chunks = existingChunks.map((c) => ({ index: c.chunkIndex, text: c.chunkText }));
        for (const c of existingChunks) chunkIdByIndex.set(c.chunkIndex, c.id);
      } else {
        chunks = chunkText(cleanText ?? "", { maxChunks: 10 });
        try {
          const embeddings = await embedTexts(chunks.map((c) => c.text));

          await db.delete(docChunks).where(eq(docChunks.documentId, docId));

          const chunkRows = await db
            .insert(docChunks)
            .values(
              chunks.map((c, i) => ({
                documentId: docId,
                chunkIndex: c.index,
                chunkText: c.text,
                embedding: embeddings[i]!,
              }))
            )
            .returning({ id: docChunks.id, chunkIndex: docChunks.chunkIndex });

          for (const r of chunkRows) chunkIdByIndex.set(r.chunkIndex, r.id);
        } catch (err) {
          await markDocumentError(docId, err);
          continue;
        }
      }

      if (disableAiForRun) {
        await markDocumentError(
          docId,
          "AI quota exhausted for this run; extraction skipped. Fix billing/quota and re-run."
        );
        continue;
      }

      let extraction: Extraction | null = null;
      try {
        extraction = await extractFromChunks({
          title: title ?? url,
          url,
          chunks,
        });
      } catch (err) {
        await markDocumentError(docId, err);
        if (isQuotaOrRateLimitError(err)) {
          disableAiForRun = true;
          console.warn(
            "[AttackAgent] AI quota/rate-limit error. Skipping extraction for remaining docs in this run."
          );
        }
        continue;
      }

      if (!extraction) {
        await markDocumentError(docId, "Extraction returned invalid JSON (or empty).");
        continue;
      }

      // Ensure referenced entities exist
      for (const a of extraction.actors ?? []) {
        if (!a?.name) continue;
        await resolveOrCreateActorByName(a.name);
      }

      const sourceRef: Pick<Source, "id" | "reliability"> = {
        id: src.id,
        reliability: src.reliability,
      };

      for (const rec of extraction.origin_countries ?? []) {
        const actorId = await resolveOrCreateActorByName(rec.actor);
        const iso2 = (rec.iso2 ?? "").toUpperCase();
        if (!/^[A-Z]{2}$/.test(iso2)) continue;
        await ensureKgEntity({ kind: "country", entityId: iso2, name: iso2 });
        const relationId = await upsertRelationObservation({
          type: "actor_origin_country",
          fromKind: "actor",
          fromId: actorId,
          toKind: "country",
          toId: iso2,
          obsConfidence: rec.confidence ?? 0.5,
          source: sourceRef,
        });
        await insertEvidence({
          relationId,
          documentId: docId,
          url,
          publishedAt,
          excerpt: rec.excerpt ?? "",
          confidence: rec.confidence ?? 0.5,
          chunkId: rec.chunk_index != null ? chunkIdByIndex.get(rec.chunk_index) ?? null : null,
        });
      }

      for (const rec of extraction.target_sectors ?? []) {
        const actorId = await resolveOrCreateActorByName(rec.actor);
        const sector = (rec.sector ?? "").toLowerCase();
        if (!isSector(sector)) continue;
        await ensureKgEntity({ kind: "sector", entityId: sector, name: sector });
        const relationId = await upsertRelationObservation({
          type: "actor_targets_sector",
          fromKind: "actor",
          fromId: actorId,
          toKind: "sector",
          toId: sector,
          obsConfidence: rec.confidence ?? 0.5,
          source: sourceRef,
        });
        await insertEvidence({
          relationId,
          documentId: docId,
          url,
          publishedAt,
          excerpt: rec.excerpt ?? "",
          confidence: rec.confidence ?? 0.5,
          chunkId: rec.chunk_index != null ? chunkIdByIndex.get(rec.chunk_index) ?? null : null,
        });
      }

      for (const rec of extraction.techniques ?? []) {
        const actorId = await resolveOrCreateActorByName(rec.actor);
        const technique = (rec.technique ?? "").toUpperCase();
        if (!/^T\d{4}(?:\.\d{3})?$/.test(technique)) continue;
        await ensureKgEntityIfMissing({
          kind: "technique",
          entityId: technique,
          name: technique,
          attributes: { unresolved: true, createdFrom: "osint" },
        });
        const relationId = await upsertRelationObservation({
          type: "actor_uses_technique",
          fromKind: "actor",
          fromId: actorId,
          toKind: "technique",
          toId: technique,
          obsConfidence: rec.confidence ?? 0.5,
          source: sourceRef,
        });
        await insertEvidence({
          relationId,
          documentId: docId,
          url,
          publishedAt,
          excerpt: rec.excerpt ?? "",
          confidence: rec.confidence ?? 0.5,
          chunkId: rec.chunk_index != null ? chunkIdByIndex.get(rec.chunk_index) ?? null : null,
        });
      }

      for (const rec of extraction.cves ?? []) {
        const actorId = await resolveOrCreateActorByName(rec.actor);
        const cve = (rec.cve ?? "").toUpperCase();
        if (!/^CVE-\d{4}-\d{4,}$/.test(cve)) continue;
        await ensureKgEntity({ kind: "cve", entityId: cve, name: cve });
        const relationId = await upsertRelationObservation({
          type: "actor_exploits_cve",
          fromKind: "actor",
          fromId: actorId,
          toKind: "cve",
          toId: cve,
          obsConfidence: rec.confidence ?? 0.5,
          source: sourceRef,
        });
        await insertEvidence({
          relationId,
          documentId: docId,
          url,
          publishedAt,
          excerpt: rec.excerpt ?? "",
          confidence: rec.confidence ?? 0.5,
          chunkId: rec.chunk_index != null ? chunkIdByIndex.get(rec.chunk_index) ?? null : null,
        });
      }
    }

    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(sources.id, src.id));
  }

  console.log("[AttackAgent] Done.");
}

if (process.argv[1]?.endsWith("attack.ts")) {
  runAttackAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
