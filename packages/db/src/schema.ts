import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  jsonb,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  doublePrecision,
  customType,
} from "drizzle-orm/pg-core";

export const vector1536 = customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (typeof value !== "string") return [];
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => Number(v));
  },
});

// ─── Enums ────────────────────────────────────────────────────────────────────

export const agentEnum = pgEnum("agent_type", [
  "vuln",
  "attack",
  "ttp",
  "exploit",
  "malware",
]);

export const severityEnum = pgEnum("severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const pocLevelEnum = pgEnum("poc_level", ["poc", "functional", "itw"]);

export const userTierEnum = pgEnum("user_tier", ["free", "pro"]);

export const sourceTypeEnum = pgEnum("source_type", ["rss", "stix"]);

export const docStatusEnum = pgEnum("doc_status", ["ok", "error"]);

export const mergeStatusEnum = pgEnum("merge_status", [
  "pending",
  "accepted",
  "rejected",
]);

// ─── Findings ─────────────────────────────────────────────────────────────────

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Which agent produced this
    agent: agentEnum("agent").notNull(),

    // Core content
    title: text("title").notNull(),
    summary: text("summary"), // AI-generated, may be null until processed
    rawData: text("raw_data"), // JSON string of original source payload

    // Severity & scoring
    severity: severityEnum("severity"),
    cvssScore: numeric("cvss_score", { precision: 4, scale: 1 }),
    cvssVector: text("cvss_vector"),

    // CVE info (vuln + exploit agents)
    cveId: text("cve_id"),

    // MITRE ATT&CK (comma-separated technique IDs, e.g. "T1059,T1059.001")
    mitreIds: text("mitre_ids"),

    // Tags for filtering (products, threat actors, sectors — JSON array string)
    tags: text("tags"),

    // Source
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),

    // Exploit/PoC fields (exploit agent)
    pocUrl: text("poc_url"),
    pocLevel: pocLevelEnum("poc_level"),
    // Hours from CVE publish to PoC drop (our key metric)
    disclosureToExploitHours: numeric("disclosure_to_exploit_hours", {
      precision: 8,
      scale: 1,
    }),

    // Dedup: hash of (agent + cveId or sourceUrl) to prevent re-inserting same finding
    dedupHash: text("dedup_hash").notNull(),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupIdx: uniqueIndex("findings_dedup_hash_idx").on(t.dedupHash),
    agentIdx: index("findings_agent_idx").on(t.agent),
    severityIdx: index("findings_severity_idx").on(t.severity),
    cveIdx: index("findings_cve_id_idx").on(t.cveId),
    publishedIdx: index("findings_published_at_idx").on(t.publishedAt),
  })
);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    clerkId: text("clerk_id").notNull(),
    tier: userTierEnum("tier").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clerkIdx: uniqueIndex("users_clerk_id_idx").on(t.clerkId),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

// ─── User Stack (for personalized alerts) ────────────────────────────────────

export const userStack = pgTable(
  "user_stack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // e.g. "nginx", "apache", "windows_server", "log4j", "kubernetes"
    technology: text("technology").notNull(),
    // Optional: "2.4.x", "<=1.14" etc.
    versionRange: text("version_range"),
    // Sector they care about: "energy" | "finance" | "healthcare" | "all"
    sector: text("sector").default("all"),
  },
  (t) => ({
    userIdx: index("user_stack_user_id_idx").on(t.userId),
  })
);

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"), // "email" | "webhook"
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFindingIdx: uniqueIndex("alerts_user_finding_idx").on(
      t.userId,
      t.findingId
    ),
  })
);

// ─── Types ────────────────────────────────────────────────────────────────────

// â”€â”€â”€ Sources (RSS + STIX) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: sourceTypeEnum("type").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    reliability: doublePrecision("reliability").notNull().default(1),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    urlIdx: uniqueIndex("sources_url_idx").on(t.url),
    typeIdx: index("sources_type_idx").on(t.type),
    enabledIdx: index("sources_enabled_idx").on(t.enabled),
  })
);

// â”€â”€â”€ Documents + embeddings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    title: text("title"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentHash: text("content_hash").notNull(),
    cleanText: text("clean_text"),
    status: docStatusEnum("status").notNull().default("ok"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    urlIdx: uniqueIndex("documents_url_idx").on(t.url),
    hashIdx: index("documents_hash_idx").on(t.contentHash),
    publishedIdx: index("documents_published_at_idx").on(t.publishedAt),
  })
);

export const docChunks = pgTable(
  "doc_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector1536("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    docIdx: index("doc_chunks_document_id_idx").on(t.documentId),
    docChunkIdx: uniqueIndex("doc_chunks_doc_chunk_idx").on(
      t.documentId,
      t.chunkIndex
    ),
  })
);

// â”€â”€â”€ Knowledge graph â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const kgEntities = pgTable(
  "kg_entities",
  {
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    name: text("name").notNull(),
    aliases: text("aliases").array(),
    description: text("description"),
    attributes: jsonb("attributes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.kind, t.entityId] }),
    kindIdx: index("kg_entities_kind_idx").on(t.kind),
    nameIdx: index("kg_entities_name_idx").on(t.name),
  })
);

export const kgRelations = pgTable(
  "kg_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    fromKind: text("from_kind").notNull(),
    fromId: text("from_id").notNull(),
    toKind: text("to_kind").notNull(),
    toId: text("to_id").notNull(),
    support: doublePrecision("support").notNull().default(0),
    confidence: doublePrecision("confidence").notNull().default(0),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attributes: jsonb("attributes"),
  },
  (t) => ({
    uniq: uniqueIndex("kg_relations_unique_idx").on(
      t.type,
      t.fromKind,
      t.fromId,
      t.toKind,
      t.toId
    ),
    fromIdx: index("kg_relations_from_idx").on(t.fromKind, t.fromId),
    toIdx: index("kg_relations_to_idx").on(t.toKind, t.toId),
    typeIdx: index("kg_relations_type_idx").on(t.type),
    lastSeenIdx: index("kg_relations_last_seen_idx").on(t.lastSeen),
  })
);

export const kgEvidence = pgTable(
  "kg_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    relationId: uuid("relation_id")
      .notNull()
      .references(() => kgRelations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => docChunks.id, {
      onDelete: "set null",
    }),
    excerpt: text("excerpt").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    confidence: doublePrecision("confidence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    relIdx: index("kg_evidence_relation_id_idx").on(t.relationId),
    docIdx: index("kg_evidence_document_id_idx").on(t.documentId),
  })
);

export const kgAliases = pgTable(
  "kg_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    alias: text("alias").notNull(),
    aliasNorm: text("alias_norm").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("kg_aliases_kind_alias_norm_idx").on(t.kind, t.aliasNorm),
    entityIdx: index("kg_aliases_kind_entity_idx").on(t.kind, t.entityId),
  })
);

export const kgMergeCandidates = pgTable(
  "kg_merge_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    fromEntityId: text("from_entity_id").notNull(),
    toEntityId: text("to_entity_id").notNull(),
    method: text("method").notNull(),
    score: doublePrecision("score").notNull().default(0),
    status: mergeStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("kg_merge_candidates_status_idx").on(t.status),
    kindIdx: index("kg_merge_candidates_kind_idx").on(t.kind),
  })
);

// â”€â”€â”€ Actor similarity (offline computed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const actorProfiles = pgTable(
  "actor_profiles",
  {
    actorId: text("actor_id").primaryKey(),
    profileText: text("profile_text").notNull(),
    embedding: vector1536("embedding").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actorIdx: index("actor_profiles_actor_id_idx").on(t.actorId),
  })
);

export const actorNeighbors = pgTable(
  "actor_neighbors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").notNull(),
    neighborActorId: text("neighbor_actor_id").notNull(),
    distance: doublePrecision("distance").notNull(),
    whyJson: jsonb("why_json"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("actor_neighbors_unique_idx").on(
      t.actorId,
      t.neighborActorId
    ),
    actorIdx: index("actor_neighbors_actor_id_idx").on(t.actorId),
  })
);

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserStack = typeof userStack.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocChunk = typeof docChunks.$inferSelect;
export type KgEntity = typeof kgEntities.$inferSelect;
export type KgRelation = typeof kgRelations.$inferSelect;
export type KgEvidence = typeof kgEvidence.$inferSelect;
export type KgAlias = typeof kgAliases.$inferSelect;
export type KgMergeCandidate = typeof kgMergeCandidates.$inferSelect;
export type ActorProfile = typeof actorProfiles.$inferSelect;
export type ActorNeighbor = typeof actorNeighbors.$inferSelect;
