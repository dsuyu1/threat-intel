/**
 * OriginAgent — seeds actor_origin_country from publicly available MITRE ATT&CK
 * actor descriptions (heuristic extraction).
 *
 * Also ingests MISP Galaxy threat-actor cluster metadata to map MITRE ATT&CK
 * group IDs (G####) to `meta.country` ISO2 codes.
 *
 * Run: pnpm run:origin
 */

import "../lib/env.js";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { and, eq, sql } from "drizzle-orm";
import {
  documents,
  getDb,
  kgAliases,
  kgEntities,
  kgEvidence,
  kgRelations,
  type Source,
} from "@ti/db";
import { ensureDefaultSources, DEFAULT_STIX_SOURCE, getEnabledSources } from "../lib/sources.js";
import { ensureKgEntity, ensureKgEntityIfMissing, insertEvidence, normalizeAlias } from "../lib/kg.js";
import { inferOriginFromText } from "../lib/origin.js";

const MISP_GALAXY_URL =
  "https://raw.githubusercontent.com/MISP/misp-galaxy/main/clusters/threat-actor.json";

function countryName(iso2: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

async function ensureMitreDocument(params: { stixUrl: string; sourceId: string | null }): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: documents.id, sourceId: documents.sourceId })
    .from(documents)
    .where(eq(documents.url, params.stixUrl))
    .limit(1);
  if (existing[0]?.id) {
    if (!existing[0].sourceId && params.sourceId) {
      await db.update(documents).set({ sourceId: params.sourceId }).where(eq(documents.id, existing[0].id));
    }
    return existing[0].id;
  }

  const hash = crypto.createHash("sha256").update(params.stixUrl).digest("hex");
  const inserted = await db
    .insert(documents)
    .values({
      url: params.stixUrl,
      title: "MITRE ATT&CK Enterprise STIX",
      contentHash: hash,
      cleanText: null,
      status: "ok",
      sourceId: params.sourceId,
    })
    .returning({ id: documents.id });
  return inserted[0]!.id;
}

async function getStixSource(): Promise<Source | null> {
  await ensureDefaultSources();
  const enabled = await getEnabledSources("stix");
  return enabled.find((s) => s.url === DEFAULT_STIX_SOURCE.url) ?? enabled[0] ?? null;
}

async function ensureDocument(params: { url: string; title: string }): Promise<string> {
  const db = getDb();
  const existing = await db.select({ id: documents.id }).from(documents).where(eq(documents.url, params.url)).limit(1);
  if (existing[0]?.id) return existing[0].id;

  const hash = crypto.createHash("sha256").update(params.url).digest("hex");
  const inserted = await db
    .insert(documents)
    .values({
      url: params.url,
      title: params.title,
      contentHash: hash,
      cleanText: null,
      status: "ok",
    })
    .returning({ id: documents.id });

  return inserted[0]!.id;
}

function parseIso2(x: unknown): string | null {
  const iso2 = String(x ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(iso2) ? iso2 : null;
}

function parseConfidence(x: unknown): number {
  // MISP uses "attribution-confidence": "50" (percent) for many entries.
  const n = Number(x);
  if (Number.isFinite(n)) {
    const pct = n > 1 ? n / 100 : n;
    return Math.max(0.1, Math.min(0.95, pct));
  }
  return 0.6;
}

function extractMitreGroupIdFromSynonyms(x: unknown): string | null {
  const list = Array.isArray(x) ? x : [];
  for (const s of list) {
    const v = String(s ?? "").trim().toUpperCase();
    if (/^G\d{4}$/.test(v)) return v;
  }
  return null;
}

function buildCandidateNames(params: { value?: string; synonyms?: unknown }): string[] {
  const out: string[] = [];
  const v = params.value?.trim();
  if (v) out.push(v);
  if (Array.isArray(params.synonyms)) out.push(...params.synonyms.map((s) => String(s ?? "").trim()));
  return out.filter(Boolean);
}

function resolveActorIdByAlias(params: {
  actorIdByAliasNorm: Map<string, string>;
  name: string;
}): string | null {
  const norm = normalizeAlias(params.name);
  if (!norm) return null;
  return params.actorIdByAliasNorm.get(norm) ?? null;
}

async function upsertOriginRelation(params: {
  fromId: string;
  iso2: string;
  support: number;
  confidence: number;
  now?: Date;
}): Promise<string> {
  const db = getDb();
  const now = params.now ?? new Date();

  const inserted = await db
    .insert(kgRelations)
    .values({
      type: "actor_origin_country",
      fromKind: "actor",
      fromId: params.fromId,
      toKind: "country",
      toId: params.iso2,
      support: Math.max(0, params.support),
      confidence: Math.max(0, Math.min(1, params.confidence)),
      firstSeen: now,
      lastSeen: now,
      attributes: null,
    })
    .onConflictDoUpdate({
      target: [
        kgRelations.type,
        kgRelations.fromKind,
        kgRelations.fromId,
        kgRelations.toKind,
        kgRelations.toId,
      ],
      set: {
        support: sql`GREATEST(${kgRelations.support}, excluded.support)`,
        confidence: sql`GREATEST(${kgRelations.confidence}, excluded.confidence)`,
        firstSeen: sql`LEAST(${kgRelations.firstSeen}, excluded.first_seen)`,
        lastSeen: sql`GREATEST(${kgRelations.lastSeen}, excluded.last_seen)`,
        attributes: sql`COALESCE(${kgRelations.attributes}, excluded.attributes)`,
      },
    })
    .returning({ id: kgRelations.id });

  return inserted[0]!.id;
}

async function seedFromMispGalaxy(params: { documentId: string }) {
  console.log("[OriginAgent] Ingesting MISP Galaxy threat actors...");
  const db = getDb();

  // Build an in-memory alias lookup to map MISP actor names/synonyms → canonical KG actor IDs.
  const aliasRows = await db
    .select({ aliasNorm: kgAliases.aliasNorm, entityId: kgAliases.entityId })
    .from(kgAliases)
    .where(eq(kgAliases.kind, "actor"));
  const actorIdByAliasNorm = new Map(aliasRows.map((r) => [r.aliasNorm, r.entityId]));

  const res = await fetch(MISP_GALAXY_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "threat-intel-platform/1.0",
    },
  });
  if (!res.ok) throw new Error(`MISP Galaxy fetch failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("MISP Galaxy fetch returned no body");

  let rows = 0;
  let withCountry = 0;
  let withSynonyms = 0;
  let withMitreId = 0;
  let mapped = 0;

  const pipeline = chain([
    Readable.fromWeb(res.body as never),
    parser(),
    pick({ filter: "values" }),
    streamArray(),
  ]);

  for await (const data of pipeline) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const obj = (data as any).value as {
      value?: string;
      description?: string;
      meta?: Record<string, unknown>;
    };
    rows += 1;

    const meta = obj.meta ?? {};
    const iso2 = parseIso2(meta["country"]);
    if (!iso2) continue;
    withCountry += 1;

    const directMitreId = extractMitreGroupIdFromSynonyms(meta["synonyms"]);
    if (Array.isArray(meta["synonyms"])) withSynonyms += 1;

    let actorId: string | null = directMitreId;
    if (!actorId) {
      // Try mapping by alias (value + synonyms) → KG actor ID (prefer MITRE G#### IDs)
      const candidates = buildCandidateNames({ value: obj.value, synonyms: meta["synonyms"] });
      for (const name of candidates) {
        const resolved = resolveActorIdByAlias({ actorIdByAliasNorm, name });
        if (resolved && /^G\d{4}$/.test(resolved)) {
          actorId = resolved;
          break;
        }
      }
    }

    if (!actorId) continue;
    withMitreId += 1;

    const confidence = parseConfidence(meta["attribution-confidence"]);

    await ensureKgEntity({
      kind: "country",
      entityId: iso2,
      name: countryName(iso2),
      attributes: { source: "iso3166" },
    });

    await ensureKgEntityIfMissing({
      kind: "actor",
      entityId: actorId,
      name: obj.value?.trim() ? obj.value.trim() : actorId,
      attributes: { unresolved: true, createdFrom: "misp-galaxy" },
    });

    const relationId = await upsertOriginRelation({
      fromId: actorId,
      iso2,
      support: confidence,
      confidence,
    });

    const refs = Array.isArray(meta["refs"]) ? meta["refs"] : [];
    const refUrl = typeof refs[0] === "string" ? refs[0] : MISP_GALAXY_URL;

    const hasEvidence = await db
      .select({ id: kgEvidence.id })
      .from(kgEvidence)
      .where(and(eq(kgEvidence.relationId, relationId as never), eq(kgEvidence.url, refUrl)))
      .limit(1);

    if (!hasEvidence[0]?.id) {
      await insertEvidence({
        relationId,
        documentId: params.documentId,
        url: refUrl,
        publishedAt: null,
        excerpt: obj.description ?? `MISP Galaxy maps ${actorId} → ${iso2}`,
        confidence,
      });
    }

    mapped += 1;
  }

  console.log(`[OriginAgent] MISP processed: ${rows} rows, mapped: ${mapped}`);
  console.log(`[OriginAgent] MISP stats: withCountry=${withCountry} withSynonyms=${withSynonyms} withMitreId=${withMitreId}`);
}

export async function runOriginAgent() {
  console.log("[OriginAgent] Starting...");
  const db = getDb();

  const stixSource = await getStixSource();
  const mitreDocId = await ensureMitreDocument({
    stixUrl: stixSource?.url ?? DEFAULT_STIX_SOURCE.url,
    sourceId: stixSource?.id ?? null,
  });
  const mispDocId = await ensureDocument({ url: MISP_GALAXY_URL, title: "MISP Galaxy - Threat Actors" });

  const actors = await db
    .select({
      id: kgEntities.entityId,
      name: kgEntities.name,
      description: kgEntities.description,
    })
    .from(kgEntities)
    .where(eq(kgEntities.kind, "actor"));

  let inferred = 0;
  let inserted = 0;

  for (const a of actors) {
    if (!a.id || !a.description) continue;
    if (!/^G\d{4}$/.test(a.id)) continue; // only MITRE intrusion set IDs

    const origin = inferOriginFromText(a.description);
    if (!origin) continue;
    inferred += 1;

    const iso2 = origin.iso2;
    await ensureKgEntity({
      kind: "country",
      entityId: iso2,
      name: countryName(iso2),
      attributes: { source: "iso3166" },
    });

    const relationId = await upsertOriginRelation({
      fromId: a.id,
      iso2,
      support: origin.confidence,
      confidence: origin.confidence,
    });

    const url = `https://attack.mitre.org/groups/${a.id}/`;
    const hasEvidence = await db
      .select({ id: kgEvidence.id })
      .from(kgEvidence)
      .where(and(eq(kgEvidence.relationId, relationId as never), eq(kgEvidence.url, url)))
      .limit(1);

    if (!hasEvidence[0]?.id) {
      await insertEvidence({
        relationId,
        documentId: mitreDocId,
        url,
        publishedAt: null,
        excerpt: origin.excerpt,
        confidence: origin.confidence,
      });
    }

    inserted += 1;
  }

  console.log(`[OriginAgent] Done. Actors inferred: ${inferred} | Relations upserted: ${inserted}`);

  await seedFromMispGalaxy({ documentId: mispDocId });

  console.log("[OriginAgent] Complete.");
}

if (process.argv[1]?.endsWith("origin.ts")) {
  runOriginAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
