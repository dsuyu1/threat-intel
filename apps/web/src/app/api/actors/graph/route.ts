export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { actorNeighbors, getDb, kgEntities, kgRelations } from "@ti/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { toIsoStringSafe } from "../../../../lib/dates";

type NodeKey = `${string}:${string}`;

type GraphNode = {
  key: NodeKey;
  kind: string;
  entityId: string;
  name: string;
};

type GraphEdge = {
  id: string;
  type: string;
  from: NodeKey;
  to: NodeKey;
  support: number;
  confidence: number;
  lastSeen: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIntParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function parseFloatParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseBoolParam(value: string | null, fallback = false) {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function splitKey(key: string): { kind: string; entityId: string } {
  const idx = key.indexOf(":");
  if (idx <= 0) return { kind: "", entityId: key };
  return { kind: key.slice(0, idx), entityId: key.slice(idx + 1) };
}

function buildEndpointCondition(params: {
  kindCol: typeof kgRelations.fromKind | typeof kgRelations.toKind;
  idCol: typeof kgRelations.fromId | typeof kgRelations.toId;
  idsByKind: Map<string, string[]>;
}) {
  const clauses = [];
  for (const [kind, ids] of params.idsByKind.entries()) {
    if (!ids.length) continue;
    clauses.push(and(eq(params.kindCol, kind), inArray(params.idCol, ids)));
  }
  return clauses.length ? or(...clauses) : undefined;
}

async function fetchEntityNames(params: {
  db: ReturnType<typeof getDb>;
  nodesByKey: Map<NodeKey, { kind: string; entityId: string }>;
}) {
  const idsByKind = new Map<string, string[]>();
  for (const { kind, entityId } of params.nodesByKey.values()) {
    const list = idsByKind.get(kind) ?? [];
    list.push(entityId);
    idsByKind.set(kind, list);
  }

  const nameByKey = new Map<NodeKey, string>();
  for (const [kind, ids] of idsByKind.entries()) {
    const deduped = [...new Set(ids)];
    if (deduped.length === 0) continue;

    const rows = await params.db
      .select({
        kind: kgEntities.kind,
        entityId: kgEntities.entityId,
        name: kgEntities.name,
      })
      .from(kgEntities)
      .where(and(eq(kgEntities.kind, kind), inArray(kgEntities.entityId, deduped)))
      .limit(5000);

    for (const r of rows) {
      const key = `${r.kind}:${r.entityId}` as NodeKey;
      nameByKey.set(key, r.name);
    }
  }

  return nameByKey;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const actorId = (sp.get("actorId") ?? "").trim();
  if (!actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }

  const depth = clamp(parseIntParam(sp.get("depth"), 2), 1, 4);
  const maxNodes = clamp(parseIntParam(sp.get("maxNodes"), 160), 25, 500);
  const maxEdges = clamp(parseIntParam(sp.get("maxEdges"), 420), 50, 2000);
  const minSupport = clamp(parseFloatParam(sp.get("minSupport"), 0), 0, 1000);

  const includeSimilarity = parseBoolParam(sp.get("includeSimilarity"), true);
  const includeDerived = parseBoolParam(sp.get("includeDerived"), false);

  const db = getDb();
  const [center] = await db
    .select({ name: kgEntities.name })
    .from(kgEntities)
    .where(and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, actorId)))
    .limit(1);

  if (!center) {
    return NextResponse.json({ error: "actor not found" }, { status: 404 });
  }

  const centerKey = `actor:${actorId}` as const;

  const nodesByKey = new Map<NodeKey, { kind: string; entityId: string }>();
  const distanceByKey = new Map<NodeKey, number>();
  nodesByKey.set(centerKey, { kind: "actor", entityId: actorId });
  distanceByKey.set(centerKey, 0);

  const edgesById = new Map<string, GraphEdge>();
  let truncated = false;

  const excludedTypes = new Set<string>();
  if (!includeDerived) excludedTypes.add("technique_mitigated_by");

  let frontier = new Set<NodeKey>([centerKey]);

  const addNode = (key: NodeKey, kind: string, entityId: string, dist: number) => {
    if (nodesByKey.has(key)) return true;
    if (nodesByKey.size >= maxNodes) {
      truncated = true;
      return false;
    }
    nodesByKey.set(key, { kind, entityId });
    distanceByKey.set(key, dist);
    return true;
  };

  for (let step = 0; step < depth; step++) {
    if (frontier.size === 0) break;
    if (edgesById.size >= maxEdges) {
      truncated = true;
      break;
    }

    const idsByKind = new Map<string, string[]>();
    for (const key of frontier) {
      const { kind, entityId } = splitKey(key);
      if (!kind || !entityId) continue;
      const list = idsByKind.get(kind) ?? [];
      list.push(entityId);
      idsByKind.set(kind, list);
    }

    const fromCond = buildEndpointCondition({
      kindCol: kgRelations.fromKind,
      idCol: kgRelations.fromId,
      idsByKind,
    });
    const toCond = buildEndpointCondition({
      kindCol: kgRelations.toKind,
      idCol: kgRelations.toId,
      idsByKind,
    });

    const whereParts = [];
    if (fromCond && toCond) whereParts.push(or(fromCond, toCond));
    else if (fromCond) whereParts.push(fromCond);
    else if (toCond) whereParts.push(toCond);

    if (minSupport > 0) whereParts.push(sql`${kgRelations.support} >= ${minSupport}`);
    if (excludedTypes.size === 1) {
      const only = [...excludedTypes][0]!;
      whereParts.push(sql`${kgRelations.type} <> ${only}`);
    } else if (excludedTypes.size > 1) {
      const values = [...excludedTypes].map((t) => sql`${t}`);
      whereParts.push(sql`${kgRelations.type} not in (${sql.join(values, sql`,`)})`);
    }

    const whereExpr = whereParts.length ? and(...whereParts) : undefined;

    const remaining = Math.max(0, maxEdges - edgesById.size);
    const limit = clamp(remaining, 1, 600);

    const rows = await db
      .select({
        id: kgRelations.id,
        type: kgRelations.type,
        fromKind: kgRelations.fromKind,
        fromId: kgRelations.fromId,
        toKind: kgRelations.toKind,
        toId: kgRelations.toId,
        support: kgRelations.support,
        confidence: kgRelations.confidence,
        lastSeen: kgRelations.lastSeen,
      })
      .from(kgRelations)
      .where(whereExpr)
      .orderBy(desc(kgRelations.support), desc(kgRelations.confidence), desc(kgRelations.lastSeen))
      .limit(limit);

    const nextFrontier = new Set<NodeKey>();

    for (const r of rows) {
      if (edgesById.size >= maxEdges) {
        truncated = true;
        break;
      }

      const edgeId = r.id;
      if (edgesById.has(edgeId)) continue;

      const fromKey = `${r.fromKind}:${r.fromId}` as NodeKey;
      const toKey = `${r.toKind}:${r.toId}` as NodeKey;

      const fromDist = distanceByKey.get(fromKey);
      const toDist = distanceByKey.get(toKey);

      const nextDist = step + 1;

      if (fromDist === undefined) addNode(fromKey, r.fromKind, r.fromId, nextDist);
      if (toDist === undefined) addNode(toKey, r.toKind, r.toId, nextDist);

      if (!nodesByKey.has(fromKey) || !nodesByKey.has(toKey)) {
        truncated = true;
        continue;
      }

      edgesById.set(edgeId, {
        id: edgeId,
        type: r.type,
        from: fromKey,
        to: toKey,
        support: Number(r.support ?? 0),
        confidence: Number(r.confidence ?? 0),
        lastSeen: toIsoStringSafe(r.lastSeen),
      });

      if ((distanceByKey.get(fromKey) ?? 99) === nextDist) nextFrontier.add(fromKey);
      if ((distanceByKey.get(toKey) ?? 99) === nextDist) nextFrontier.add(toKey);
    }

    frontier = nextFrontier;
  }

  if (includeSimilarity) {
    const remainingEdges = Math.max(0, maxEdges - edgesById.size);
    if (remainingEdges > 0) {
      const rows = await db
        .select({
          neighborActorId: actorNeighbors.neighborActorId,
          distance: actorNeighbors.distance,
        })
        .from(actorNeighbors)
        .where(eq(actorNeighbors.actorId, actorId))
        .orderBy(actorNeighbors.distance)
        .limit(12);

      for (const r of rows) {
        if (edgesById.size >= maxEdges) {
          truncated = true;
          break;
        }

        const otherKey = `actor:${r.neighborActorId}` as const;
        addNode(otherKey, "actor", r.neighborActorId, 1);
        if (!nodesByKey.has(otherKey)) {
          truncated = true;
          continue;
        }

        const edgeId = `similarity:${actorId}:${r.neighborActorId}`;
        if (edgesById.has(edgeId)) continue;

        const sim = 1 - (Number.isFinite(r.distance) ? r.distance : 1);
        edgesById.set(edgeId, {
          id: edgeId,
          type: "actor_similar_actor",
          from: centerKey,
          to: otherKey,
          support: clamp(sim, 0, 1),
          confidence: 0,
          lastSeen: null,
        });
      }
    }
  }

  const nameByKey = await fetchEntityNames({ db, nodesByKey });
  const nodes: GraphNode[] = [...nodesByKey.entries()].map(([key, v]) => ({
    key,
    kind: v.kind,
    entityId: v.entityId,
    name: key === centerKey ? center.name : nameByKey.get(key) ?? v.entityId,
  }));

  return NextResponse.json({
    center: centerKey,
    nodes,
    edges: [...edgesById.values()],
    truncated,
  });
}
