/**
 * IocTaxiiImportAgent — ingests IOC indicators from TAXII 2.1 feeds into per-project IOC tables.
 *
 * Scope:
 * - Iterates enabled `ioc_taxii_connections` (all projects)
 * - Pulls STIX indicator objects from the TAXII collection
 * - Extracts IOCs from STIX patterns and upserts:
 *   - iocs
 *   - ioc_sources (source_kind=taxii)
 *
 * Run: pnpm run:agents -- --agentKey ioc-taxii ...
 * Cron: scheduled (serverless.yml)
 */

import "../lib/env.js";
import { decryptSecret } from "../lib/secretbox.js";
import {
  extractIocsFromStixPattern,
  getDb,
  kgEntities,
  kgRelations,
  iocSources,
  iocTaxiiConnections,
  iocs,
  type NormalizedIoc,
} from "@ti/db";
import { and, asc, eq, sql } from "drizzle-orm";

type ConnectionRow = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  apiRootUrl: string;
  collectionId: string;
  authScheme: "none" | "bearer" | "basic";
  apiKeyEnc: string | null;
  username: string | null;
  passwordEnc: string | null;
  lookbackDays: number;
  lastSyncedAt: Date | null;
  nextCursor: string | null;
};

type TaxiiObjectsResponse = {
  objects?: unknown[];
  more?: boolean;
  next?: string;
};

type StixExternalRef = {
  source_name?: string;
  external_id?: string;
  url?: string;
};

type KgEntityRow = {
  kind: string;
  entityId: string;
  name: string;
  aliases: string[] | null;
  description: string | null;
  attributes: unknown;
};

type KgRelationRow = {
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

type Db = ReturnType<typeof getDb>;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clamp01(n: number) {
  return clamp(n, 0, 1);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseDate(value: unknown): Date | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toBasicAuth(username: string, password: string) {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function buildAuthHeader(conn: ConnectionRow): Promise<string | null> {
  if (conn.authScheme === "none") return null;
  if (conn.authScheme === "bearer") {
    if (!conn.apiKeyEnc) throw new Error("Bearer auth selected but api_key_enc is missing");
    const key = await decryptSecret(conn.apiKeyEnc);
    return `Bearer ${key}`;
  }
  if (conn.authScheme === "basic") {
    if (!conn.username) throw new Error("Basic auth selected but username is missing");
    if (!conn.passwordEnc) throw new Error("Basic auth selected but password_enc is missing");
    const password = await decryptSecret(conn.passwordEnc);
    return toBasicAuth(conn.username, password);
  }
  return null;
}

function objectsUrl(conn: ConnectionRow, params: { sinceIso?: string; next?: string; limit?: number }) {
  const base = String(conn.apiRootUrl ?? "").replace(/\/+$/, "");
  const url = new URL(`${base}/collections/${encodeURIComponent(conn.collectionId)}/objects/`);
  if (params.next) url.searchParams.set("next", params.next);
  else if (params.sinceIso) url.searchParams.set("added_after", params.sinceIso);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  return url.toString();
}

function getIndicatorTimestampRange(obj: any): { firstSeenAt: Date | null; lastSeenAt: Date | null } {
  const validFrom = parseDate(obj?.valid_from);
  const validUntil = parseDate(obj?.valid_until);
  const created = parseDate(obj?.created);
  const modified = parseDate(obj?.modified);

  const first = validFrom ?? created ?? modified ?? null;
  const last = validUntil ?? modified ?? created ?? null;

  return { firstSeenAt: first, lastSeenAt: last };
}

function getExternalUrl(obj: any): string | null {
  const refs = Array.isArray(obj?.external_references) ? obj.external_references : [];
  for (const r of refs) {
    const url = typeof r?.url === "string" ? r.url.trim() : "";
    if (url) return url;
  }
  return null;
}

function getAttackExternalId(refs: StixExternalRef[] | undefined): string | null {
  if (!refs) return null;
  for (const ref of refs) {
    if (ref.source_name === "mitre-attack" && ref.external_id) return String(ref.external_id);
  }
  return null;
}

function getCitations(refs: StixExternalRef[] | undefined): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  for (const ref of refs ?? []) {
    const name = typeof ref.source_name === "string" ? ref.source_name.trim() : "";
    const url = typeof ref.url === "string" ? ref.url.trim() : "";
    if (!name || !url) continue;
    out.push({ name, url });
  }
  const seen = new Set<string>();
  const deduped: typeof out = [];
  for (const c of out) {
    const key = `${c.name}||${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  return deduped;
}

function stixTypeFromId(stixId: string): string {
  const s = String(stixId ?? "").trim();
  const idx = s.indexOf("--");
  return idx > 0 ? s.slice(0, idx) : "";
}

function kindFromStixType(stixType: string): string {
  const t = String(stixType ?? "").trim().toLowerCase();
  if (t === "intrusion-set") return "actor";
  if (t === "attack-pattern") return "technique";
  if (t === "campaign") return "campaign";
  if (t === "malware") return "malware";
  if (t === "tool") return "tool";
  if (t === "indicator") return "indicator";
  if (t === "vulnerability") return "vulnerability";
  return t || "unknown";
}

function resolveKgRefForStixId(
  stixId: string,
  idMap: Map<string, { kind: string; entityId: string }>
): { kind: string; entityId: string } {
  const hit = idMap.get(stixId);
  if (hit) return hit;
  const kind = kindFromStixType(stixTypeFromId(stixId));
  return { kind, entityId: stixId };
}

async function insertEntitiesIfMissing(db: Db, rows: KgEntityRow[], now: Date): Promise<void> {
  if (!rows.length) return;
  for (const batch of chunk(rows, 800)) {
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
      .onConflictDoNothing();
  }
}

async function upsertRelations(db: Db, rows: KgRelationRow[]): Promise<void> {
  if (!rows.length) return;
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
        target: [kgRelations.type, kgRelations.fromKind, kgRelations.fromId, kgRelations.toKind, kgRelations.toId],
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

type PendingSource = {
  ioc: NormalizedIoc;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  externalId: string;
  externalUrl: string | null;
  confidence: number | null;
  rawJson: unknown;
};

export async function runIocTaxiiImportAgent(opts?: { maxPagesPerConnection?: number }) {
  const db = getDb();
  const maxPagesPerConnection = clamp(opts?.maxPagesPerConnection ?? 15, 1, 100);

  const connections = (await db
    .select({
      id: iocTaxiiConnections.id,
      projectId: iocTaxiiConnections.projectId,
      name: iocTaxiiConnections.name,
      enabled: iocTaxiiConnections.enabled,
      apiRootUrl: iocTaxiiConnections.apiRootUrl,
      collectionId: iocTaxiiConnections.collectionId,
      authScheme: iocTaxiiConnections.authScheme,
      apiKeyEnc: iocTaxiiConnections.apiKeyEnc,
      username: iocTaxiiConnections.username,
      passwordEnc: iocTaxiiConnections.passwordEnc,
      lookbackDays: iocTaxiiConnections.lookbackDays,
      lastSyncedAt: iocTaxiiConnections.lastSyncedAt,
      nextCursor: iocTaxiiConnections.nextCursor,
    })
    .from(iocTaxiiConnections)
    .where(eq(iocTaxiiConnections.enabled, true))
    .orderBy(asc(iocTaxiiConnections.name))
    .limit(500)) as unknown as ConnectionRow[];

  let pagesFetched = 0;
  let indicatorsSeen = 0;
  let iocsUpserted = 0;
  let sourcesUpserted = 0;
  let connectionsProcessed = 0;
  let connectionsErrored = 0;

  for (const conn of connections) {
    connectionsProcessed++;
    const now = new Date();

    const startSince = conn.lastSyncedAt ?? new Date(now.getTime() - clamp(conn.lookbackDays ?? 30, 1, 365) * 86400 * 1000);
    const sinceIso = startSince.toISOString();

    let authHeader: string | null = null;
    try {
      authHeader = await buildAuthHeader(conn);
    } catch (err) {
      connectionsErrored++;
      console.warn(`[ioc-taxii] ${conn.name}: failed to build auth header:`, err);
      continue;
    }

    // If this is the first-ever sync and we have to paginate, keep the starting point.
    if (!conn.lastSyncedAt) {
      await db
        .update(iocTaxiiConnections)
        .set({ lastSyncedAt: startSince, updatedAt: now })
        .where(eq(iocTaxiiConnections.id, conn.id));
    }

    let cursor: string | null = conn.nextCursor ?? null;
    let page = 0;

    while (page < maxPagesPerConnection) {
      page++;
      const url = objectsUrl(conn, { sinceIso: cursor ? undefined : sinceIso, next: cursor ?? undefined, limit: 2000 });

      let data: TaxiiObjectsResponse;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            accept: "application/taxii+json;version=2.1, application/json",
            ...(authHeader ? { authorization: authHeader } : {}),
          },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`TAXII objects fetch failed (${res.status}): ${text.slice(0, 400)}`);
        }

        data = (await res.json().catch(() => ({}))) as TaxiiObjectsResponse;
      } catch (err) {
        connectionsErrored++;
        console.warn(`[ioc-taxii] ${conn.name}: fetch failed:`, err);
        break;
      }

      pagesFetched++;

      const objects = Array.isArray(data.objects) ? data.objects : [];
      const next = typeof data.next === "string" && data.next.trim() ? data.next.trim() : null;

      const pendingSources: PendingSource[] = [];
      const byKey = new Map<string, { ioc: NormalizedIoc; firstSeenAt: Date | null; lastSeenAt: Date | null }>();
      const idMap = new Map<string, { kind: string; entityId: string }>();
      const entityByKey = new Map<string, KgEntityRow>();
      const relationships: Array<{
        id: string | null;
        relationshipType: string;
        sourceRef: string;
        targetRef: string;
        confidence: number | null;
      }> = [];
      const indicatorConfidenceById = new Map<string, number>();

      for (const obj of objects as any[]) {
        if (!obj || typeof obj !== "object") continue;
        if (obj.type === "indicator") {
          const pattern = typeof obj.pattern === "string" ? obj.pattern : "";
          if (!pattern) continue;

          indicatorsSeen++;

          const extracted = extractIocsFromStixPattern(pattern);
          if (!extracted.length) continue;

          const { firstSeenAt, lastSeenAt } = getIndicatorTimestampRange(obj);
          const externalId = String(obj.id ?? "").trim() || `indicator:${Math.random().toString(16).slice(2)}`;
          const externalUrl = getExternalUrl(obj);
          const confidence =
            typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
              ? Math.max(0, Math.min(100, Math.round(obj.confidence)))
              : null;

          if (typeof confidence === "number") indicatorConfidenceById.set(externalId, confidence);

          for (const ioc of extracted) {
            const key = `${ioc.kind}:${ioc.normalized}`;
            const prev = byKey.get(key);
            if (!prev) byKey.set(key, { ioc, firstSeenAt, lastSeenAt });
            else {
              const minFirst =
                prev.firstSeenAt && firstSeenAt
                  ? prev.firstSeenAt.getTime() <= firstSeenAt.getTime()
                    ? prev.firstSeenAt
                    : firstSeenAt
                  : prev.firstSeenAt ?? firstSeenAt;
              const maxLast =
                prev.lastSeenAt && lastSeenAt
                  ? prev.lastSeenAt.getTime() >= lastSeenAt.getTime()
                    ? prev.lastSeenAt
                    : lastSeenAt
                  : prev.lastSeenAt ?? lastSeenAt;
              byKey.set(key, { ioc: prev.ioc, firstSeenAt: minFirst, lastSeenAt: maxLast });
            }

            pendingSources.push({ ioc, firstSeenAt, lastSeenAt, externalId, externalUrl, confidence, rawJson: obj });
          }
          continue;
        }

        if (obj.type === "relationship") {
          const relationshipType = typeof obj.relationship_type === "string" ? obj.relationship_type.trim() : "";
          const sourceRef = typeof obj.source_ref === "string" ? obj.source_ref.trim() : "";
          const targetRef = typeof obj.target_ref === "string" ? obj.target_ref.trim() : "";
          if (!relationshipType || !sourceRef || !targetRef) continue;
          const confidence =
            typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
              ? Math.max(0, Math.min(100, Math.round(obj.confidence)))
              : null;
          relationships.push({
            id: typeof obj.id === "string" ? obj.id : null,
            relationshipType,
            sourceRef,
            targetRef,
            confidence,
          });
          continue;
        }

        const stixId = typeof obj.id === "string" ? obj.id.trim() : "";
        const stixType = typeof obj.type === "string" ? obj.type.trim() : "";
        if (!stixId || !stixType) continue;

        const refs = Array.isArray(obj?.external_references) ? (obj.external_references as StixExternalRef[]) : undefined;
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        const description = typeof obj.description === "string" ? obj.description.trim() : "";

        const citations = getCitations(refs);

        if (stixType === "intrusion-set") {
          const externalId = getAttackExternalId(refs) || stixId;
          idMap.set(stixId, { kind: "actor", entityId: externalId });
          const key = `actor||${externalId}`;
          if (!entityByKey.has(key)) {
            entityByKey.set(key, {
              kind: "actor",
              entityId: externalId,
              name: name || externalId,
              aliases: Array.isArray(obj.aliases) ? (obj.aliases as string[]).map((a) => String(a)).filter(Boolean).slice(0, 50) : null,
              description: description || null,
              attributes: { source: "taxii", connectionId: conn.id, stixId, citations },
            });
          }
        } else if (stixType === "attack-pattern") {
          const externalId = getAttackExternalId(refs) || stixId;
          idMap.set(stixId, { kind: "technique", entityId: externalId });
          const key = `technique||${externalId}`;
          if (!entityByKey.has(key)) {
            entityByKey.set(key, {
              kind: "technique",
              entityId: externalId,
              name: name || externalId,
              aliases: null,
              description: description || null,
              attributes: { source: "taxii", connectionId: conn.id, stixId, citations },
            });
          }
        } else if (stixType === "campaign") {
          const externalId = getAttackExternalId(refs) || stixId;
          idMap.set(stixId, { kind: "campaign", entityId: externalId });
          const key = `campaign||${externalId}`;
          if (!entityByKey.has(key)) {
            entityByKey.set(key, {
              kind: "campaign",
              entityId: externalId,
              name: name || externalId,
              aliases: null,
              description: description || null,
              attributes: { source: "taxii", connectionId: conn.id, stixId, citations },
            });
          }
        } else if (stixType === "malware") {
          const externalId = stixId;
          idMap.set(stixId, { kind: "malware", entityId: externalId });
          const key = `malware||${externalId}`;
          if (!entityByKey.has(key)) {
            entityByKey.set(key, {
              kind: "malware",
              entityId: externalId,
              name: name || externalId,
              aliases: null,
              description: description || null,
              attributes: { source: "taxii", connectionId: conn.id, stixId, citations },
            });
          }
        } else if (stixType === "tool") {
          const externalId = stixId;
          idMap.set(stixId, { kind: "tool", entityId: externalId });
          const key = `tool||${externalId}`;
          if (!entityByKey.has(key)) {
            entityByKey.set(key, {
              kind: "tool",
              entityId: externalId,
              name: name || externalId,
              aliases: null,
              description: description || null,
              attributes: { source: "taxii", connectionId: conn.id, stixId, citations },
            });
          }
        }
      }

      const iocRows = [...byKey.values()].map((v) => ({
        projectId: conn.projectId,
        kind: v.ioc.kind as any,
        value: v.ioc.value,
        normalized: v.ioc.normalized,
        tags: [],
        firstSeenAt: v.firstSeenAt ?? now,
        lastSeenAt: v.lastSeenAt ?? now,
        createdAt: now,
        updatedAt: now,
      }));

      const iocIdByKey = new Map<string, string>();

      if (iocRows.length) {
        for (const batch of chunk(iocRows, 500)) {
          const returned = await db
            .insert(iocs)
            .values(batch)
            .onConflictDoUpdate({
              target: [iocs.projectId, iocs.kind, iocs.normalized],
              set: {
                value: sql`excluded.value`,
                firstSeenAt: sql`coalesce(least(${iocs.firstSeenAt}, excluded.first_seen_at), ${iocs.firstSeenAt}, excluded.first_seen_at)`,
                lastSeenAt: sql`coalesce(greatest(${iocs.lastSeenAt}, excluded.last_seen_at), excluded.last_seen_at)`,
                updatedAt: now,
              },
            })
            .returning({ id: iocs.id, kind: iocs.kind, normalized: iocs.normalized });

          iocsUpserted += returned.length;
          for (const r of returned) {
            iocIdByKey.set(`${r.kind}:${r.normalized}`, r.id);
          }
        }
      }

      if (pendingSources.length && iocIdByKey.size) {
        const sourceRows = pendingSources
          .map((s) => {
            const iocId = iocIdByKey.get(`${s.ioc.kind}:${s.ioc.normalized}`);
            if (!iocId) return null;
            return {
              projectId: conn.projectId,
              iocId,
              sourceKind: "taxii" as any,
              connectionId: conn.id,
              externalId: s.externalId,
              externalUrl: s.externalUrl,
              confidence: s.confidence,
              firstSeenAt: s.firstSeenAt,
              lastSeenAt: s.lastSeenAt,
              rawJson: s.rawJson as any,
              createdAt: now,
              updatedAt: now,
            };
          })
          .filter(Boolean) as any[];

        for (const batch of chunk(sourceRows, 500)) {
          const returned = await db
            .insert(iocSources)
            .values(batch)
            .onConflictDoUpdate({
              target: [iocSources.sourceKind, iocSources.connectionId, iocSources.externalId, iocSources.iocId],
              set: {
                externalUrl: sql`excluded.external_url`,
                confidence: sql`excluded.confidence`,
                firstSeenAt: sql`coalesce(least(${iocSources.firstSeenAt}, excluded.first_seen_at), ${iocSources.firstSeenAt}, excluded.first_seen_at)`,
                lastSeenAt: sql`coalesce(greatest(${iocSources.lastSeenAt}, excluded.last_seen_at), excluded.last_seen_at)`,
                rawJson: sql`excluded.raw_json`,
                updatedAt: now,
              },
            })
            .returning({ id: iocSources.id });
          sourcesUpserted += returned.length;
        }
      }

  // ─── KG mapping from TAXII relationships ──────────────────────────────────
      try {
        const iocIdsByIndicatorId = new Map<string, string[]>();
        for (const s of pendingSources) {
          const iocId = iocIdByKey.get(`${s.ioc.kind}:${s.ioc.normalized}`);
          if (!iocId) continue;
          const indicatorId = s.externalId;
          const prev = iocIdsByIndicatorId.get(indicatorId) ?? [];
          if (!prev.includes(iocId)) prev.push(iocId);
          iocIdsByIndicatorId.set(indicatorId, prev);
        }

        const iocIdsCache = new Map<string, string[]>();
        for (const [k, v] of iocIdsByIndicatorId) iocIdsCache.set(k, v);

        async function loadIocIdsForIndicator(indicatorId: string): Promise<string[]> {
          const hit = iocIdsCache.get(indicatorId);
          if (hit) return hit;

          const rows = await db
            .select({ iocId: iocSources.iocId })
            .from(iocSources)
            .where(
              and(
                eq(iocSources.projectId, conn.projectId),
                eq(iocSources.sourceKind, "taxii" as any),
                eq(iocSources.connectionId, conn.id),
                eq(iocSources.externalId, indicatorId)
              )
            )
            .limit(2000);

          const ids = rows.map((r) => String(r.iocId));
          iocIdsCache.set(indicatorId, ids);
          return ids;
        }

        const entityRows = Array.from(entityByKey.values());
        await insertEntitiesIfMissing(db, entityRows, now);

        const relationByKey = new Map<string, KgRelationRow>();
        const pushRelation = (r: KgRelationRow) => {
          const key = `${r.type}||${r.fromKind}||${r.fromId}||${r.toKind}||${r.toId}`;
          if (!relationByKey.has(key)) relationByKey.set(key, r);
        };

        for (const rel of relationships) {
          const relationshipType = rel.relationshipType;
          const src = resolveKgRefForStixId(rel.sourceRef, idMap);
          const dst = resolveKgRefForStixId(rel.targetRef, idMap);

          const relConfidence = rel.confidence != null ? clamp01(rel.confidence / 100) : null;

          // 1) Promote intrusion-set uses attack-pattern into our canonical actor_uses_technique relation.
          if (relationshipType === "uses") {
            const actor = src.kind === "actor" ? src : dst.kind === "actor" ? dst : null;
            const tech = src.kind === "technique" ? src : dst.kind === "technique" ? dst : null;
            if (actor && tech) {
              pushRelation({
                type: "actor_uses_technique",
                fromKind: "actor",
                fromId: actor.entityId,
                toKind: "technique",
                toId: tech.entityId,
                support: 1,
                confidence: relConfidence ?? 0.7,
                firstSeen: now,
                lastSeen: now,
                attributes: { source: "taxii", connectionId: conn.id, relationshipId: rel.id, relationshipType },
              });
            }
          }

          // 2) Translate indicator indicates * into IOC→TTP relations (one indicator can yield multiple IOCs).
          if (relationshipType === "indicates") {
            const srcType = stixTypeFromId(rel.sourceRef);
            const dstType = stixTypeFromId(rel.targetRef);
            const indicatorId = srcType === "indicator" ? rel.sourceRef : dstType === "indicator" ? rel.targetRef : null;
            const other = indicatorId
              ? indicatorId === rel.sourceRef
                ? dst
                : src
              : null;

            if (indicatorId && other && (other.kind === "actor" || other.kind === "technique")) {
              const iocIds = await loadIocIdsForIndicator(indicatorId);
              const indConfidenceRaw = indicatorConfidenceById.get(indicatorId);
              const indConfidence = typeof indConfidenceRaw === "number" ? clamp01(indConfidenceRaw / 100) : null;
              const conf = relConfidence ?? indConfidence ?? 0.6;

              for (const iocId of iocIds) {
                pushRelation({
                  type: other.kind === "actor" ? "ioc_indicates_actor" : "ioc_indicates_technique",
                  fromKind: "ioc",
                  fromId: iocId,
                  toKind: other.kind,
                  toId: other.entityId,
                  support: 1,
                  confidence: conf,
                  firstSeen: now,
                  lastSeen: now,
                  attributes: {
                    source: "taxii",
                    connectionId: conn.id,
                    indicatorId,
                    relationshipId: rel.id,
                    relationshipType,
                  },
                });
              }
            }
          }

          // 3) Store raw TAXII relationship edges (useful for later graphs/mappings).
          if (relationshipType !== "indicates") {
            pushRelation({
              type: `taxii_${relationshipType}`,
              fromKind: src.kind,
              fromId: src.entityId,
              toKind: dst.kind,
              toId: dst.entityId,
              support: 1,
              confidence: relConfidence ?? 0.6,
              firstSeen: now,
              lastSeen: now,
              attributes: { source: "taxii", connectionId: conn.id, relationshipId: rel.id, relationshipType },
            });
          }
        }

        const relationRows = Array.from(relationByKey.values());
        await upsertRelations(db, relationRows);
      } catch (err) {
        console.warn(`[ioc-taxii] ${conn.name}: KG mapping failed:`, err);
      }

      // Update pagination state.
      cursor = next;
      if (cursor) {
        await db
          .update(iocTaxiiConnections)
          .set({ nextCursor: cursor, updatedAt: now })
          .where(eq(iocTaxiiConnections.id, conn.id));
      } else {
        await db
          .update(iocTaxiiConnections)
          .set({ lastSyncedAt: now, nextCursor: null, updatedAt: now })
          .where(eq(iocTaxiiConnections.id, conn.id));
      }

      if (!cursor) break;
    }
  }

  return {
    connectionsProcessed,
    connectionsErrored,
    pagesFetched,
    indicatorsSeen,
    iocsUpserted,
    sourcesUpserted,
  };
}
