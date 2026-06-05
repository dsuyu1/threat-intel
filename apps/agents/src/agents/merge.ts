/**
 * MergeAgent — applies accepted entity merge candidates.
 *
 * Workflow:
 * - AttackAgent writes fuzzy merge suggestions into `kg_merge_candidates` (pending).
 * - Human reviews in DB: set status='accepted' for a row to approve.
 * - MergeAgent runs manually and applies accepted merges (reviewed_at is set when applied).
 *
 * Run: pnpm --filter agents run run:merge
 */

import "../lib/env.js";
import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, kgEntities, kgMergeCandidates, kgRelations } from "@ti/db";

type RelRow = {
  id: string;
  type: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  support: number;
  confidence: number;
  firstSeen: Date;
  lastSeen: Date;
};

function toNum(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export async function runMergeAgent(opts?: { limit?: number }) {
  console.log("[MergeAgent] Starting...");

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = getDb();
  const limit = opts?.limit ?? 25;

  const candidates = await db
    .select()
    .from(kgMergeCandidates)
    .where(and(eq(kgMergeCandidates.status, "accepted"), isNull(kgMergeCandidates.reviewedAt)))
    .limit(limit);

  if (candidates.length === 0) {
    console.log("[MergeAgent] No accepted merge candidates to apply.");
    return;
  }

  const sql = neon(url);

  for (const c of candidates) {
    const kind = c.kind;
    const fromId = c.fromEntityId;
    const toId = c.toEntityId;

    const [fromEntity] = await db
      .select()
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, kind), eq(kgEntities.entityId, fromId)))
      .limit(1);
    const [toEntity] = await db
      .select()
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, kind), eq(kgEntities.entityId, toId)))
      .limit(1);

    if (!fromEntity || !toEntity) {
      console.warn("[MergeAgent] Skipping candidate (missing entity):", { kind, fromId, toId });
      await db
        .update(kgMergeCandidates)
        .set({ reviewedAt: new Date() })
        .where(eq(kgMergeCandidates.id, c.id));
      continue;
    }

    const fromRels = (await db
      .select({
        id: kgRelations.id,
        type: kgRelations.type,
        fromKind: kgRelations.fromKind,
        fromId: kgRelations.fromId,
        toKind: kgRelations.toKind,
        toId: kgRelations.toId,
        support: kgRelations.support,
        confidence: kgRelations.confidence,
        firstSeen: kgRelations.firstSeen,
        lastSeen: kgRelations.lastSeen,
      })
      .from(kgRelations)
      .where(
        or(
          and(eq(kgRelations.fromKind, kind), eq(kgRelations.fromId, fromId)),
          and(eq(kgRelations.toKind, kind), eq(kgRelations.toId, fromId))
        )
      )) as RelRow[];

    const toRels = (await db
      .select({
        id: kgRelations.id,
        type: kgRelations.type,
        fromKind: kgRelations.fromKind,
        fromId: kgRelations.fromId,
        toKind: kgRelations.toKind,
        toId: kgRelations.toId,
        support: kgRelations.support,
        confidence: kgRelations.confidence,
        firstSeen: kgRelations.firstSeen,
        lastSeen: kgRelations.lastSeen,
      })
      .from(kgRelations)
      .where(
        or(
          and(eq(kgRelations.fromKind, kind), eq(kgRelations.fromId, toId)),
          and(eq(kgRelations.toKind, kind), eq(kgRelations.toId, toId))
        )
      )) as RelRow[];

    const relKey = (r: RelRow, override?: { fromId?: string; toId?: string }) =>
      [
        r.type,
        r.fromKind,
        override?.fromId ?? r.fromId,
        r.toKind,
        override?.toId ?? r.toId,
      ].join("||");

    const existingByKey = new Map<string, RelRow>();
    for (const r of toRels) existingByKey.set(relKey(r), r);

    const updates: Array<{ relId: string; newFromId: string; newToId: string }> = [];
    const merges: Array<{
      fromRelId: string;
      toRelId: string;
      nextSupport: number;
      nextConfidence: number;
      nextFirstSeen: Date;
      nextLastSeen: Date;
    }> = [];

    for (const r of fromRels) {
      const newFromId = r.fromKind === kind && r.fromId === fromId ? toId : r.fromId;
      const newToId = r.toKind === kind && r.toId === fromId ? toId : r.toId;
      const key = relKey(r, { fromId: newFromId, toId: newToId });
      const existing = existingByKey.get(key);
      if (existing && existing.id !== r.id) {
        merges.push({
          fromRelId: r.id,
          toRelId: existing.id,
          nextSupport: toNum(existing.support) + toNum(r.support),
          nextConfidence: Math.max(toNum(existing.confidence), toNum(r.confidence)),
          nextFirstSeen: minDate(existing.firstSeen, r.firstSeen),
          nextLastSeen: maxDate(existing.lastSeen, r.lastSeen),
        });
      } else {
        updates.push({ relId: r.id, newFromId, newToId });
      }
    }

    const mergedIntoAliases = uniq([
      ...(toEntity.aliases ?? []),
      toEntity.name,
      ...(fromEntity.aliases ?? []),
      fromEntity.name,
    ]);

    const now = new Date();

    console.log("[MergeAgent] Applying:", { kind, fromId, toId, updates: updates.length, merges: merges.length });

    await sql.transaction((txn: NeonQueryFunctionInTransaction<boolean, boolean>) => {
      const q = [];

      // Move evidence then delete merged relations.
      for (const m of merges) {
        q.push(
          txn`update kg_evidence set relation_id = ${m.toRelId} where relation_id = ${m.fromRelId}`
        );
        q.push(
          txn`update kg_relations set support = ${m.nextSupport}, confidence = ${m.nextConfidence}, first_seen = ${m.nextFirstSeen}, last_seen = ${m.nextLastSeen} where id = ${m.toRelId}`
        );
        q.push(txn`delete from kg_relations where id = ${m.fromRelId}`);
      }

      for (const u of updates) {
        q.push(
          txn`update kg_relations set from_id = ${u.newFromId}, to_id = ${u.newToId} where id = ${u.relId}`
        );
      }

      // Move aliases.
      q.push(
        txn`update kg_aliases set entity_id = ${toId} where kind = ${kind} and entity_id = ${fromId}`
      );

      // Mark merged entity for audit (no hard delete).
      q.push(txn`
        update kg_entities
        set
          attributes = jsonb_set(
            jsonb_set(coalesce(attributes, '{}'::jsonb), '{mergedInto}', to_jsonb(${toId}::text), true),
            '{mergedAt}', to_jsonb(${now.toISOString()}::text), true
          ),
          updated_at = ${now}
        where kind = ${kind} and entity_id = ${fromId}
      `);

      q.push(txn`
        update kg_entities
        set
          aliases = ${mergedIntoAliases}::text[],
          updated_at = ${now}
        where kind = ${kind} and entity_id = ${toId}
      `);

      // Mark candidate as applied.
      q.push(txn`update kg_merge_candidates set reviewed_at = ${now} where id = ${c.id}`);

      return q;
    });
  }

  console.log("[MergeAgent] Done.");
}

if (process.argv[1]?.endsWith("merge.ts")) {
  runMergeAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
