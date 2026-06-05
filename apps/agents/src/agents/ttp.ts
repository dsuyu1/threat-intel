/**
 * TtpAgent — syncs MITRE ATT&CK STIX and writes:
 * - kg_entities: actors (G####), techniques (T#### / T####.###), mitigations (M####)
 * - kg_entities: campaigns (C####)
 * - kg_aliases: actor name + aliases
 * - kg_relations: actor_uses_technique, technique_mitigated_by, actor_attributed_campaign
 *
 * Notes:
 * - Optimized for the Neon HTTP driver: minimizes DB round-trips using batched upserts.
 * - Evidence rows for MITRE-derived relations are not inserted here (OSINT ingestion
 *   provides evidence; MITRE data is treated as authoritative source-of-truth).
 *
 * Run: pnpm run:ttp
 * Force fetch (ignore ETag/Last-Modified): pnpm run:ttp -- --force
 * Cron: weekly (serverless.yml)
 */

import "../lib/env.js";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { eq, sql } from "drizzle-orm";
import {
  getDb,
  documents,
  sources,
  kgAliases,
  kgEntities,
  kgRelations,
  type Source,
} from "@ti/db";
import {
  ensureDefaultSources,
  DEFAULT_STIX_SOURCE,
  getEnabledSources,
} from "../lib/sources.js";
import { normalizeAlias } from "../lib/kg.js";

type StixExternalRef = {
  source_name?: string;
  external_id?: string;
  url?: string;
};

type StixBase = { id: string; type: string; name?: string; description?: string };

type StixIntrusionSet = StixBase & {
  type: "intrusion-set";
  aliases?: string[];
  external_references?: StixExternalRef[];
};

type StixTechnique = StixBase & {
  type: "attack-pattern";
  external_references?: StixExternalRef[];
};

type StixMitigation = StixBase & {
  type: "course-of-action";
  external_references?: StixExternalRef[];
};

type StixCampaign = StixBase & {
  type: "campaign";
  external_references?: StixExternalRef[];
};

type StixRelationship = StixBase & {
  type: "relationship";
  relationship_type: string;
  source_ref: string;
  target_ref: string;
};

type EntityRef = {
  kind: "actor" | "technique" | "mitigation" | "campaign";
  entityId: string;
};

type EntityRow = {
  kind: string;
  entityId: string;
  name: string;
  aliases: string[] | null;
  description: string | null;
  attributes: unknown;
};

type AliasRow = {
  kind: string;
  entityId: string;
  alias: string;
  aliasNorm: string;
};

type RelationRow = {
  type: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  support: number;
  confidence: number;
  firstSeen: Date;
  lastSeen: Date;
  attributes: unknown;
};

function getAttackExternalId(refs: StixExternalRef[] | undefined): string | null {
  if (!refs) return null;
  for (const ref of refs) {
    if (ref.source_name === "mitre-attack" && ref.external_id) return ref.external_id;
  }
  return null;
}

function getAttackCitations(refs: StixExternalRef[] | undefined): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  for (const ref of refs ?? []) {
    const name = ref.source_name?.trim();
    const url = ref.url?.trim();
    if (!name || !url) continue;
    if (name === "mitre-attack") continue;
    out.push({ name, url });
  }

  // Deduplicate by (name, url) while preserving order.
  const seen = new Set<string>();
  const deduped: Array<{ name: string; url: string }> = [];
  for (const c of out) {
    const key = `${c.name}||${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return deduped;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ensureMitreDocument(stixUrl: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.url, stixUrl))
    .limit(1);
  if (existing[0]?.id) return existing[0].id;

  const hash = crypto.createHash("sha256").update(stixUrl).digest("hex");
  const inserted = await db
    .insert(documents)
    .values({
      url: stixUrl,
      title: "MITRE ATT&CK Enterprise STIX",
      contentHash: hash,
      cleanText: null,
      status: "ok",
    })
    .returning({ id: documents.id });
  return inserted[0]!.id;
}

async function getStixSource(): Promise<Source> {
  await ensureDefaultSources();
  const rows = await getEnabledSources("stix");
  const found = rows.find((s) => s.url === DEFAULT_STIX_SOURCE.url) ?? rows[0];
  if (!found) throw new Error("No STIX source configured (sources.type='stix')");
  return found;
}

async function upsertEntities(rows: EntityRow[], now: Date): Promise<void> {
  const db = getDb();
  for (const batch of chunk(rows, 400)) {
    await db
      .insert(kgEntities)
      .values(
        batch.map((r) => ({
          kind: r.kind,
          entityId: r.entityId,
          name: r.name,
          aliases: r.aliases,
          description: r.description,
          attributes: (r.attributes ?? null) as never,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [kgEntities.kind, kgEntities.entityId],
        set: {
          name: sql`excluded.name`,
          aliases: sql`excluded.aliases`,
          description: sql`excluded.description`,
          attributes: sql`excluded.attributes`,
          updatedAt: now,
        },
      });
  }
}

async function insertAliases(rows: AliasRow[]): Promise<void> {
  const db = getDb();
  for (const batch of chunk(rows, 800)) {
    await db
      .insert(kgAliases)
      .values(
        batch.map((r) => ({
          kind: r.kind,
          entityId: r.entityId,
          alias: r.alias,
          aliasNorm: r.aliasNorm,
        }))
      )
      .onConflictDoNothing();
  }
}

async function upsertRelations(rows: RelationRow[]): Promise<void> {
  const db = getDb();
  for (const batch of chunk(rows, 800)) {
    await db
      .insert(kgRelations)
      .values(
        batch.map((r) => ({
          type: r.type,
          fromKind: r.fromKind,
          fromId: r.fromId,
          toKind: r.toKind,
          toId: r.toId,
          support: r.support,
          confidence: r.confidence,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          attributes: (r.attributes ?? null) as never,
        }))
      )
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
      });
  }
}

export async function runTtpAgent() {
  console.log("[TtpAgent] Starting...");
  const db = getDb();
  const src = await getStixSource();
  const forceFetch =
    process.argv.includes("--force") ||
    process.env["TTP_FORCE"] === "1" ||
    process.env["TTP_FORCE"] === "true";
  if (forceFetch) console.log("[TtpAgent] Force fetch enabled (ignoring ETag/Last-Modified).");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "threat-intel-platform/1.0",
  };
  if (!forceFetch) {
    if (src.etag) headers["If-None-Match"] = src.etag;
    if (src.lastModified) headers["If-Modified-Since"] = src.lastModified;
  }

  const res = await fetch(src.url, { headers });
  if (res.status === 304) {
    console.log(
      "[TtpAgent] STIX unchanged (304). Tip: if you changed TtpAgent parsing logic, re-run with --force once."
    );
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(sources.id, src.id));
    return;
  }
  if (!res.ok) throw new Error(`STIX fetch failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("STIX fetch returned no body");

  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  await db
    .update(sources)
    .set({
      etag: etag ?? src.etag ?? null,
      lastModified: lastModified ?? src.lastModified ?? null,
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sources.id, src.id));

  // Keep a doc row for provenance (even though we don't insert per-relation evidence here).
  await ensureMitreDocument(src.url);

  const idMap = new Map<string, EntityRef>();
  const actorById = new Map<string, EntityRow>();
  const techniqueById = new Map<string, EntityRow>();
  const mitigationById = new Map<string, EntityRow>();
  const campaignById = new Map<string, EntityRow>();
  const aliases: AliasRow[] = [];
  const relationships: Array<Pick<StixRelationship, "relationship_type" | "source_ref" | "target_ref">> = [];

  const pipeline = chain([
    Readable.fromWeb(res.body as never),
    parser(),
    pick({ filter: "objects" }),
    streamArray(),
  ]);

  for await (const data of pipeline) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const obj = (data as any).value as StixBase;
    if (!obj?.type || !obj.id) continue;

    if (obj.type === "intrusion-set") {
      const iset = obj as StixIntrusionSet;
      const gid = getAttackExternalId(iset.external_references);
      if (!gid || !iset.name) continue;

      actorById.set(gid, {
        kind: "actor",
        entityId: gid,
        name: iset.name,
        aliases: iset.aliases ?? null,
        description: iset.description ?? null,
        attributes: { source: "mitre-attack", citations: getAttackCitations(iset.external_references) },
      });
      idMap.set(iset.id, { kind: "actor", entityId: gid });

      const pushAlias = (alias: string) => {
        const norm = normalizeAlias(alias);
        if (!norm) return;
        aliases.push({ kind: "actor", entityId: gid, alias, aliasNorm: norm });
      };
      pushAlias(iset.name);
      for (const a of iset.aliases ?? []) pushAlias(a);
    } else if (obj.type === "attack-pattern") {
      const tech = obj as StixTechnique;
      const tid = getAttackExternalId(tech.external_references);
      if (!tid || !tech.name) continue;

      techniqueById.set(tid, {
        kind: "technique",
        entityId: tid,
        name: tech.name,
        aliases: null,
        description: tech.description ?? null,
        attributes: { source: "mitre-attack", citations: getAttackCitations(tech.external_references) },
      });
      idMap.set(tech.id, { kind: "technique", entityId: tid });
    } else if (obj.type === "course-of-action") {
      const mit = obj as StixMitigation;
      const mid = getAttackExternalId(mit.external_references);
      if (!mid || !mit.name) continue;

      mitigationById.set(mid, {
        kind: "mitigation",
        entityId: mid,
        name: mit.name,
        aliases: null,
        description: mit.description ?? null,
        attributes: { source: "mitre-attack", citations: getAttackCitations(mit.external_references) },
      });
      idMap.set(mit.id, { kind: "mitigation", entityId: mid });
    } else if (obj.type === "campaign") {
      const camp = obj as StixCampaign;
      const cid = getAttackExternalId(camp.external_references);
      if (!cid || !camp.name) continue;

      campaignById.set(cid, {
        kind: "campaign",
        entityId: cid,
        name: camp.name,
        aliases: null,
        description: camp.description ?? null,
        attributes: { source: "mitre-attack", citations: getAttackCitations(camp.external_references) },
      });
      idMap.set(camp.id, { kind: "campaign", entityId: cid });
    } else if (obj.type === "relationship") {
      const r = obj as StixRelationship;
      if (!r.relationship_type || !r.source_ref || !r.target_ref) continue;
      relationships.push({
        relationship_type: r.relationship_type,
        source_ref: r.source_ref,
        target_ref: r.target_ref,
      });
    }
  }

  const now = new Date();

  const entityRows: EntityRow[] = [
    ...actorById.values(),
    ...techniqueById.values(),
    ...mitigationById.values(),
    ...campaignById.values(),
  ];

  // Deduplicate alias rows by (kind, alias_norm) to avoid work.
  const aliasByKey = new Map<string, AliasRow>();
  for (const a of aliases) aliasByKey.set(`${a.kind}||${a.aliasNorm}`, a);
  const aliasRows = Array.from(aliasByKey.values());

  const relationByKey = new Map<string, RelationRow>();
  for (const r of relationships) {
    const srcRef = idMap.get(r.source_ref);
    const dstRef = idMap.get(r.target_ref);
    if (!srcRef || !dstRef) continue;

    if (
      r.relationship_type === "uses" &&
      srcRef.kind === "actor" &&
      dstRef.kind === "technique"
    ) {
      const key = `actor_uses_technique||${srcRef.entityId}||${dstRef.entityId}`;
      relationByKey.set(key, {
        type: "actor_uses_technique",
        fromKind: "actor",
        fromId: srcRef.entityId,
        toKind: "technique",
        toId: dstRef.entityId,
        support: 1,
        confidence: 1,
        firstSeen: now,
        lastSeen: now,
        attributes: { sourceId: src.id },
      });
    }

    if (
      r.relationship_type === "mitigates" &&
      srcRef.kind === "mitigation" &&
      dstRef.kind === "technique"
    ) {
      const key = `technique_mitigated_by||${dstRef.entityId}||${srcRef.entityId}`;
      relationByKey.set(key, {
        type: "technique_mitigated_by",
        fromKind: "technique",
        fromId: dstRef.entityId,
        toKind: "mitigation",
        toId: srcRef.entityId,
        support: 1,
        confidence: 1,
        firstSeen: now,
        lastSeen: now,
        attributes: { sourceId: src.id },
      });
    }

    if (r.relationship_type === "attributed-to") {
      const actorId =
        srcRef.kind === "actor"
          ? srcRef.entityId
          : dstRef.kind === "actor"
            ? dstRef.entityId
            : null;
      const campaignId =
        srcRef.kind === "campaign"
          ? srcRef.entityId
          : dstRef.kind === "campaign"
            ? dstRef.entityId
            : null;

      if (actorId && campaignId) {
        const key = `actor_attributed_campaign||${actorId}||${campaignId}`;
        relationByKey.set(key, {
          type: "actor_attributed_campaign",
          fromKind: "actor",
          fromId: actorId,
          toKind: "campaign",
          toId: campaignId,
          support: 1,
          confidence: 1,
          firstSeen: now,
          lastSeen: now,
          attributes: { sourceId: src.id },
        });
      }
    }
  }

  const relationRows = Array.from(relationByKey.values());

  console.log(
    `[TtpAgent] Parsed. Actors: ${actorById.size} | Techniques: ${techniqueById.size} | Mitigations: ${mitigationById.size} | Campaigns: ${campaignById.size} | Relations: ${relationRows.length}`
  );

  await upsertEntities(entityRows, now);
  await insertAliases(aliasRows);
  await upsertRelations(relationRows);

  console.log("[TtpAgent] Done.");
}

if (process.argv[1]?.endsWith("ttp.ts")) {
  runTtpAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
