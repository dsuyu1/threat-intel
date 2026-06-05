/**
 * ActorProfileAgent — builds per-actor profile embeddings and persists top-K neighbors.
 *
 * This agent is intentionally "offline": the web UI reads `actor_neighbors` and
 * never computes embeddings or similarity at request time.
 *
 * Run: pnpm --filter agents run run:profile
 */

import "../lib/env.js";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  actorNeighbors,
  actorProfiles,
  documents,
  getDb,
  kgEntities,
  kgEvidence,
  kgRelations,
} from "@ti/db";
import { embedTexts } from "../lib/openai.js";

type ActorFeatures = {
  sectors: string[];
  techniques: string[];
  cves: string[];
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = String(err);
  return /quota|resource_exhausted|rate limit|429/i.test(msg);
}

async function embedMany(texts: string[]): Promise<number[][]> {
  return embedTexts(texts);
}

function buildProfileText(params: {
  actorId: string;
  name: string;
  aliases: string[];
  sectors: string[];
  techniques: string[];
  cves: string[];
  recentTitles: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Actor: ${params.name} (${params.actorId})`);
  if (params.aliases.length) lines.push(`Aliases: ${params.aliases.join(", ")}`);
  if (params.sectors.length) lines.push(`Top sectors: ${params.sectors.join(", ")}`);
  if (params.techniques.length) lines.push(`Top techniques: ${params.techniques.join(", ")}`);
  if (params.cves.length) lines.push(`Attributed CVEs: ${params.cves.join(", ")}`);
  if (params.recentTitles.length) lines.push(`Recent reporting: ${params.recentTitles.join(" | ")}`);
  return lines.join("\n");
}

export async function runActorProfileAgent(opts?: { topK?: number }) {
  console.log("[ActorProfileAgent] Starting...");
  const db = getDb();
  const topK = opts?.topK ?? 8;

  const actors = await db
    .select({
      actorId: kgEntities.entityId,
      name: kgEntities.name,
      aliases: kgEntities.aliases,
      attributes: kgEntities.attributes,
    })
    .from(kgEntities)
    .where(eq(kgEntities.kind, "actor"));

  const activeActors = actors.filter((a) => {
    const attrs = (a.attributes ?? {}) as Record<string, unknown>;
    return typeof attrs["mergedInto"] !== "string";
  });

  const actorIds = activeActors.map((a) => a.actorId);
  if (actorIds.length === 0) {
    console.log("[ActorProfileAgent] No actors found.");
    return;
  }

  const sectorRels = await db
    .select({
      actorId: kgRelations.fromId,
      sectorId: kgRelations.toId,
      support: kgRelations.support,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, "actor_targets_sector"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "sector"),
        inArray(kgRelations.fromId, actorIds)
      )
    );

  const techniqueRels = await db
    .select({
      actorId: kgRelations.fromId,
      techniqueId: kgRelations.toId,
      support: kgRelations.support,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, "actor_uses_technique"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "technique"),
        inArray(kgRelations.fromId, actorIds)
      )
    );

  const cveRels = await db
    .select({
      actorId: kgRelations.fromId,
      cveId: kgRelations.toId,
      support: kgRelations.support,
    })
    .from(kgRelations)
    .where(
      and(
        eq(kgRelations.type, "actor_exploits_cve"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "cve"),
        inArray(kgRelations.fromId, actorIds)
      )
    );

  const sectorTop = new Map<string, string[]>();
  for (const r of sectorRels) {
    const list = sectorTop.get(r.actorId) ?? [];
    list.push(`${r.sectorId}::${r.support ?? 0}`);
    sectorTop.set(r.actorId, list);
  }

  const techniqueTop = new Map<string, string[]>();
  for (const r of techniqueRels) {
    const list = techniqueTop.get(r.actorId) ?? [];
    list.push(`${r.techniqueId}::${r.support ?? 0}`);
    techniqueTop.set(r.actorId, list);
  }

  const cveTop = new Map<string, string[]>();
  for (const r of cveRels) {
    const list = cveTop.get(r.actorId) ?? [];
    list.push(`${r.cveId}::${r.support ?? 0}`);
    cveTop.set(r.actorId, list);
  }

  // Technique name map (nice for embeddings)
  const techniques = await db
    .select({ id: kgEntities.entityId, name: kgEntities.name })
    .from(kgEntities)
    .where(eq(kgEntities.kind, "technique"));
  const techniqueNameById = new Map(techniques.map((t) => [t.id, t.name]));

  const profiles: Array<{
    actorId: string;
    profileText: string;
    features: ActorFeatures;
  }> = [];

  for (const a of activeActors) {
    const topSectors = (sectorTop.get(a.actorId) ?? [])
      .map((s) => {
        const [id, support] = s.split("::");
        return { id: id ?? "", support: Number(support ?? 0) };
      })
      .sort((x, y) => y.support - x.support)
      .slice(0, 6)
      .map((x) => x.id);

    const topTechniques = (techniqueTop.get(a.actorId) ?? [])
      .map((s) => {
        const [id, support] = s.split("::");
        return { id: id ?? "", support: Number(support ?? 0) };
      })
      .sort((x, y) => y.support - x.support)
      .slice(0, 10)
      .map((x) => x.id);

    const topCves = (cveTop.get(a.actorId) ?? [])
      .map((s) => {
        const [id, support] = s.split("::");
        return { id: id ?? "", support: Number(support ?? 0) };
      })
      .sort((x, y) => y.support - x.support)
      .slice(0, 8)
      .map((x) => x.id);

    const recent = await db
      .select({
        title: documents.title,
      })
      .from(kgRelations)
      .innerJoin(kgEvidence, eq(kgEvidence.relationId, kgRelations.id))
      .innerJoin(documents, eq(documents.id, kgEvidence.documentId))
      .where(and(eq(kgRelations.fromKind, "actor"), eq(kgRelations.fromId, a.actorId)))
      .orderBy(desc(kgEvidence.createdAt))
      .limit(6);

    const recentTitles = uniqueStrings(recent.map((r) => r.title ?? "").filter(Boolean));

    const aliases = uniqueStrings([a.name, ...(a.aliases ?? [])]);
    const techniqueTokens = topTechniques.map((tid) => {
      const name = techniqueNameById.get(tid);
      return name ? `${tid} (${name})` : tid;
    });

    const profileText = buildProfileText({
      actorId: a.actorId,
      name: a.name,
      aliases,
      sectors: topSectors,
      techniques: techniqueTokens,
      cves: topCves,
      recentTitles,
    });

    profiles.push({
      actorId: a.actorId,
      profileText,
      features: { sectors: topSectors, techniques: topTechniques, cves: topCves },
    });
  }

  // Embed in small batches to keep request sizes reasonable.
  const embeddingsByActorId = new Map<string, number[]>();
  for (let i = 0; i < profiles.length; i += 32) {
    const batch = profiles.slice(i, i + 32);
    let embs: number[][];
    try {
      embs = await embedMany(batch.map((p) => p.profileText));
    } catch (err) {
      if (isQuotaOrRateLimitError(err)) {
        console.warn(
          "[ActorProfileAgent] Embedding quota/rate-limit error. Skipping similarity computation for now."
        );
        return;
      }
      throw err;
    }
    for (let j = 0; j < batch.length; j++) {
      const emb = embs[j] ?? [];
      if (emb.length !== 1536) throw new Error(`Embedding dims mismatch: got ${emb.length}`);
      embeddingsByActorId.set(batch[j]!.actorId, emb);
    }
  }

  for (const p of profiles) {
    const embedding = embeddingsByActorId.get(p.actorId);
    if (!embedding) continue;
    await db
      .insert(actorProfiles)
      .values({
        actorId: p.actorId,
        profileText: p.profileText,
        embedding,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [actorProfiles.actorId],
        set: {
          profileText: p.profileText,
          embedding,
          updatedAt: new Date(),
        },
      });
  }

  const featuresByActorId = new Map<string, ActorFeatures>(
    profiles.map((p) => [p.actorId, p.features])
  );

  // Neighbors: compute in SQL using pgvector cosine distance operator (<=>).
  for (const actorId of actorIds) {
    const embedding = embeddingsByActorId.get(actorId);
    if (!embedding) continue;

    const vec = toVectorLiteral(embedding);
    const neighbors = await db
      .select({
        neighborActorId: actorProfiles.actorId,
        distance: sql<number>`(${actorProfiles.embedding} <=> ${vec}::vector)`,
      })
      .from(actorProfiles)
      .where(ne(actorProfiles.actorId, actorId))
      .orderBy(sql`(${actorProfiles.embedding} <=> ${vec}::vector) asc`)
      .limit(topK);

    await db.delete(actorNeighbors).where(eq(actorNeighbors.actorId, actorId));

    const myFeatures = featuresByActorId.get(actorId) ?? {
      sectors: [],
      techniques: [],
      cves: [],
    };

    for (const n of neighbors) {
      const other = featuresByActorId.get(n.neighborActorId) ?? {
        sectors: [],
        techniques: [],
        cves: [],
      };

      const shared = {
        sectors: myFeatures.sectors.filter((s) => other.sectors.includes(s)),
        techniques: myFeatures.techniques.filter((t) => other.techniques.includes(t)),
        cves: myFeatures.cves.filter((c) => other.cves.includes(c)),
      };

      await db.insert(actorNeighbors).values({
        actorId,
        neighborActorId: n.neighborActorId,
        distance: n.distance,
        whyJson: shared as never,
        computedAt: new Date(),
      });
    }
  }

  console.log(`[ActorProfileAgent] Done. Actors: ${actorIds.length}`);
}

if (process.argv[1]?.endsWith("profile.ts")) {
  runActorProfileAgent().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
