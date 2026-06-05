import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, kgAliases, kgEntities, kgEvidence, kgMergeCandidates, kgRelations, type Source } from "@ti/db";

const HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeAlias(alias: string): string {
  return alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decaySupport(prev: number, lastSeen: Date, now: Date): number {
  const days = Math.max(0, (now.getTime() - lastSeen.getTime()) / MS_PER_DAY);
  return prev * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const str = normalizeAlias(s).replace(/\s/g, "");
  if (str.length < 3) {
    if (str) out.add(str);
    return out;
  }
  for (let i = 0; i <= str.length - 3; i++) out.add(str.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export async function ensureKgEntity(params: {
  kind: string;
  entityId: string;
  name: string;
  aliases?: string[];
  description?: string | null;
  attributes?: unknown;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(kgEntities)
    .values({
      kind: params.kind,
      entityId: params.entityId,
      name: params.name,
      aliases: params.aliases ?? null,
      description: params.description ?? null,
      attributes: (params.attributes ?? null) as never,
    })
    .onConflictDoUpdate({
      target: [kgEntities.kind, kgEntities.entityId],
      set: {
        name: params.name,
        aliases: params.aliases ?? null,
        description: params.description ?? null,
        attributes: (params.attributes ?? null) as never,
        updatedAt: new Date(),
      },
    });
}

/**
 * Insert-only variant of ensureKgEntity(). Use for non-authoritative ingestion
 * paths to avoid overwriting richer canonical entity data (e.g. ATT&CK technique
 * names/descriptions synced by TtpAgent).
 */
export async function ensureKgEntityIfMissing(params: {
  kind: string;
  entityId: string;
  name: string;
  aliases?: string[];
  description?: string | null;
  attributes?: unknown;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(kgEntities)
    .values({
      kind: params.kind,
      entityId: params.entityId,
      name: params.name,
      aliases: params.aliases ?? null,
      description: params.description ?? null,
      attributes: (params.attributes ?? null) as never,
    })
    .onConflictDoNothing();
}

export async function ensureKgAlias(params: {
  kind: string;
  entityId: string;
  alias: string;
}): Promise<void> {
  const db = getDb();
  const aliasNorm = normalizeAlias(params.alias);
  if (!aliasNorm) return;
  await db
    .insert(kgAliases)
    .values({
      kind: params.kind,
      entityId: params.entityId,
      alias: params.alias,
      aliasNorm,
    })
    .onConflictDoNothing();
}

export async function resolveEntityIdByAlias(params: {
  kind: string;
  alias: string;
}): Promise<string | null> {
  const db = getDb();
  const aliasNorm = normalizeAlias(params.alias);
  if (!aliasNorm) return null;
  const row = await db
    .select({ entityId: kgAliases.entityId })
    .from(kgAliases)
    .where(and(eq(kgAliases.kind, params.kind), eq(kgAliases.aliasNorm, aliasNorm)))
    .limit(1);
  return row[0]?.entityId ?? null;
}

export async function resolveOrCreateActorByName(name: string): Promise<string> {
  const existing = await resolveEntityIdByAlias({ kind: "actor", alias: name });
  if (existing) return existing;

  const actorId = `U-${crypto.randomUUID()}`;
  await ensureKgEntity({
    kind: "actor",
    entityId: actorId,
    name,
    aliases: [name],
    attributes: { unresolved: true, createdFrom: "osint" },
  });
  await ensureKgAlias({ kind: "actor", entityId: actorId, alias: name });

  await suggestActorMergeCandidates({ fromActorId: actorId, actorName: name });
  return actorId;
}

export async function suggestActorMergeCandidates(params: {
  fromActorId: string;
  actorName: string;
  topN?: number;
  minScore?: number;
}): Promise<void> {
  const db = getDb();
  const topN = params.topN ?? 5;
  const minScore = params.minScore ?? 0.82;

  const actorNorm = normalizeAlias(params.actorName);
  if (!actorNorm) return;

  const all = await db
    .select({
      entityId: kgAliases.entityId,
      alias: kgAliases.alias,
      aliasNorm: kgAliases.aliasNorm,
    })
    .from(kgAliases)
    .where(eq(kgAliases.kind, "actor"));

  const targetTris = trigrams(actorNorm);
  const scored = all
    .filter((c) => c.entityId !== params.fromActorId)
    .map((c) => ({
      entityId: c.entityId,
      alias: c.alias,
      score: jaccard(targetTris, trigrams(c.aliasNorm)),
    }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  for (const s of scored) {
    await db
      .insert(kgMergeCandidates)
      .values({
        kind: "actor",
        fromEntityId: params.fromActorId,
        toEntityId: s.entityId,
        method: "fuzzy",
        score: s.score,
        status: "pending",
      })
      .onConflictDoNothing();
  }
}

export async function upsertRelationObservation(params: {
  type: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  obsConfidence: number;
  source: Pick<Source, "id" | "reliability"> | null;
  now?: Date;
}): Promise<string> {
  const db = getDb();
  const now = params.now ?? new Date();
  const reliability = params.source?.reliability ?? 1;
  const increment = Math.max(0, Math.min(1, params.obsConfidence)) * reliability;

  const existing = await db
    .select({
      id: kgRelations.id,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, params.type),
        eq(kgRelations.fromKind, params.fromKind),
        eq(kgRelations.fromId, params.fromId),
        eq(kgRelations.toKind, params.toKind),
        eq(kgRelations.toId, params.toId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    const inserted = await db
      .insert(kgRelations)
      .values({
        type: params.type,
        fromKind: params.fromKind,
        fromId: params.fromId,
        toKind: params.toKind,
        toId: params.toId,
        support: increment,
        confidence: Math.max(0, Math.min(1, params.obsConfidence)),
        firstSeen: now,
        lastSeen: now,
        attributes: params.source ? ({ sourceId: params.source.id } as never) : null,
      })
      .returning({ id: kgRelations.id });
    return inserted[0]!.id;
  }

  const prev = existing[0]!;
  const prevSupport = typeof prev.support === "number" ? prev.support : 0;
  const prevLastSeen = prev.lastSeen ?? now;
  const decayed = decaySupport(prevSupport, prevLastSeen, now);
  const nextSupport = decayed + increment;
  const nextConfidence = Math.max(
    typeof prev.confidence === "number" ? prev.confidence : 0,
    Math.max(0, Math.min(1, params.obsConfidence))
  );

  await db
    .update(kgRelations)
    .set({
      support: nextSupport,
      confidence: nextConfidence,
      lastSeen: now,
      attributes: params.source ? ({ sourceId: params.source.id } as never) : null,
    })
    .where(eq(kgRelations.id, prev.id));

  return prev.id;
}

export async function insertEvidence(params: {
  relationId: string;
  documentId: string;
  url: string;
  publishedAt: Date | null;
  excerpt: string;
  confidence: number;
  chunkId?: string | null;
}): Promise<void> {
  const db = getDb();
  const excerpt = params.excerpt.trim().slice(0, 240);
  if (!excerpt) return;
  await db.insert(kgEvidence).values({
    relationId: params.relationId as never,
    documentId: params.documentId as never,
    chunkId: (params.chunkId ?? null) as never,
    excerpt,
    url: params.url,
    publishedAt: params.publishedAt ?? null,
    confidence: Math.max(0, Math.min(1, params.confidence)),
  });
}
