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

export const navigatorRiskAppetiteEnum = pgEnum("navigator_risk_appetite", [
  "conservative",
  "balanced",
  "aggressive",
]);

export const navigatorScenarioTypeEnum = pgEnum("navigator_scenario_type", [
  "cve",
  "technique",
  "inferred",
]);

export const navigatorActionStatusEnum = pgEnum("navigator_action_status", [
  "todo",
  "in_progress",
  "done",
]);

export const navigatorScenarioValidationStatusEnum = pgEnum(
  "navigator_scenario_validation_status",
  ["unvalidated", "in_progress", "validated", "not_applicable"]
);

export const navigatorDetectionFormatEnum = pgEnum("navigator_detection_format", [
  "sigma",
  "kql",
  "spl",
]);

export const riskStatusEnum = pgEnum("risk_status", [
  "open",
  "accepted",
  "mitigating",
  "closed",
]);

export const riskCategoryEnum = pgEnum("risk_category", [
  "operational",
  "financial",
  "compliance",
  "reputational",
]);

export const complianceFrameworkEnum = pgEnum("compliance_framework", [
  "nist_csf_2",
  "cis_v8",
  "iso_27001",
]);

export const complianceSourceKindEnum = pgEnum("compliance_source_kind", [
  "mitigation",
  "technique",
  "scenario",
]);

export const sourceTypeEnum = pgEnum("source_type", ["rss", "stix"]);

export const docStatusEnum = pgEnum("doc_status", ["ok", "error"]);

export const mergeStatusEnum = pgEnum("merge_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const agentKindEnum = pgEnum("agent_kind", ["system", "custom"]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "running",
  "succeeded",
  "failed",
  "skipped",
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

// ─── Teams & Projects (multi-user workspaces) ──────────────────────────────────

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkOrgId: text("clerk_org_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clerkOrgIdx: uniqueIndex("teams_clerk_org_id_idx").on(t.clerkOrgId),
  })
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    teamIdx: index("projects_team_id_idx").on(t.teamId),
    teamSlugIdx: uniqueIndex("projects_team_slug_idx").on(t.teamId, t.slug),
  })
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultProjectId: uuid("default_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    defaultProjectIdx: index("user_preferences_default_project_id_idx").on(t.defaultProjectId),
  })
);

// ─── User Stack (for personalized alerts) ────────────────────────────────────

export const userStack = pgTable(
  "user_stack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
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
    projectIdx: index("user_stack_project_id_idx").on(t.projectId),
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

export type JiraAutomationCriteria = {
  agents?: string[];
  severities?: string[];
  minCvss?: number;
  requireCve?: boolean;
  requireKev?: boolean;
  tagsAny?: string[];
  tagsAll?: string[];
};

export const jiraAutomationConnections = pgTable(
  "jira_automation_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    webhookUrl: text("webhook_url").notNull(),
    criteria: jsonb("criteria").$type<JiraAutomationCriteria>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("jira_automation_connections_user_id_idx").on(t.userId),
    projectIdx: index("jira_automation_connections_project_id_idx").on(t.projectId),
    enabledIdx: index("jira_automation_connections_enabled_idx").on(t.enabled),
    userNameIdx: uniqueIndex("jira_automation_connections_user_name_idx").on(
      t.projectId,
      t.name
    ),
  })
);

export const jiraAutomationDeliveries = pgTable(
  "jira_automation_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => jiraAutomationConnections.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("sent"), // "sent" | "failed" | "error"
    httpStatus: integer("http_status"),
    error: text("error"),
    responseBody: text("response_body"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueDeliveryIdx: uniqueIndex("jira_automation_delivery_unique_idx").on(
      t.connectionId,
      t.findingId
    ),
    findingIdx: index("jira_automation_deliveries_finding_id_idx").on(t.findingId),
    connectionIdx: index("jira_automation_deliveries_connection_id_idx").on(
      t.connectionId
    ),
    sentAtIdx: index("jira_automation_deliveries_sent_at_idx").on(t.sentAt),
  })
);

export type WebhookDeliveryCriteria = JiraAutomationCriteria;
export type SoarWebhookHeaders = Record<string, string>;

export const slackWebhookConnections = pgTable(
  "slack_webhook_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    webhookUrl: text("webhook_url").notNull(),
    criteria: jsonb("criteria")
      .$type<WebhookDeliveryCriteria>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("slack_webhook_connections_user_id_idx").on(t.userId),
    projectIdx: index("slack_webhook_connections_project_id_idx").on(t.projectId),
    enabledIdx: index("slack_webhook_connections_enabled_idx").on(t.enabled),
    userNameIdx: uniqueIndex("slack_webhook_connections_user_name_idx").on(
      t.projectId,
      t.name
    ),
  })
);

export const discordWebhookConnections = pgTable(
  "discord_webhook_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    webhookUrl: text("webhook_url").notNull(),
    criteria: jsonb("criteria")
      .$type<WebhookDeliveryCriteria>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("discord_webhook_connections_user_id_idx").on(t.userId),
    projectIdx: index("discord_webhook_connections_project_id_idx").on(t.projectId),
    enabledIdx: index("discord_webhook_connections_enabled_idx").on(t.enabled),
    userNameIdx: uniqueIndex("discord_webhook_connections_user_name_idx").on(
      t.projectId,
      t.name
    ),
  })
);

export const soarWebhookConnections = pgTable(
  "soar_webhook_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    webhookUrl: text("webhook_url").notNull(),
    headers: jsonb("headers").$type<SoarWebhookHeaders>().notNull().default({}),
    criteria: jsonb("criteria")
      .$type<WebhookDeliveryCriteria>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("soar_webhook_connections_user_id_idx").on(t.userId),
    projectIdx: index("soar_webhook_connections_project_id_idx").on(t.projectId),
    enabledIdx: index("soar_webhook_connections_enabled_idx").on(t.enabled),
    userNameIdx: uniqueIndex("soar_webhook_connections_user_name_idx").on(
      t.projectId,
      t.name
    ),
  })
);

// ─── Types ────────────────────────────────────────────────────────────────────

// â”€â”€â”€ Sources (RSS + STIX) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const splunkConnections = pgTable(
  "splunk_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    baseUrl: text("base_url").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    app: text("app").notNull().default("search"),
    owner: text("owner").notNull().default("nobody"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("splunk_connections_user_id_idx").on(t.userId),
    projectIdx: index("splunk_connections_project_id_idx").on(t.projectId),
    enabledIdx: index("splunk_connections_enabled_idx").on(t.enabled),
    userNameIdx: uniqueIndex("splunk_connections_user_name_idx").on(t.projectId, t.name),
  })
);

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

// â”€â”€â”€ Agent management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const userAiKeys = pgTable(
  "user_ai_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // e.g. "openai" | "gemini" (app-validated)
    provider: text("provider").notNull().default("openai"),
    apiKeyEnc: text("api_key_enc").notNull(),
    baseUrl: text("base_url"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("user_ai_keys_unique_idx").on(t.projectId, t.userId, t.provider),
    userIdx: index("user_ai_keys_user_id_idx").on(t.userId),
    projectIdx: index("user_ai_keys_project_id_idx").on(t.projectId),
  })
);

export const agentSettings = pgTable(
  "agent_settings",
  {
    // e.g. "vuln" | "ttp" | "navigator" | "custom-runner"
    agentKey: text("agent_key").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    enabledIdx: index("agent_settings_enabled_idx").on(t.enabled),
  })
);

export const customAgents = pgTable(
  "custom_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    scheduleMinutes: integer("schedule_minutes").notNull().default(1440),
    definition: jsonb("definition").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("custom_agents_user_id_idx").on(t.userId),
    enabledIdx: index("custom_agents_enabled_idx").on(t.enabled),
    projectIdx: index("custom_agents_project_id_idx").on(t.projectId),
    userNameIdx: uniqueIndex("custom_agents_user_name_idx").on(t.projectId, t.name),
  })
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentKey: text("agent_key").notNull(),
    kind: agentKindEnum("kind").notNull().default("system"),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    customAgentId: uuid("custom_agent_id").references(() => customAgents.id, {
      onDelete: "cascade",
    }),
    status: agentRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    metrics: jsonb("metrics"),
  },
  (t) => ({
    keyIdx: index("agent_runs_agent_key_idx").on(t.agentKey),
    statusIdx: index("agent_runs_status_idx").on(t.status),
    startedIdx: index("agent_runs_started_at_idx").on(t.startedAt),
    customIdx: index("agent_runs_custom_agent_id_idx").on(t.customAgentId),
    userIdx: index("agent_runs_user_id_idx").on(t.userId),
    projectIdx: index("agent_runs_project_id_idx").on(t.projectId),
  })
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    progress: integer("progress"),
  },
  (t) => ({
    runIdx: index("agent_run_events_run_id_idx").on(t.runId),
    atIdx: index("agent_run_events_at_idx").on(t.at),
  })
);

export const agentOutputs = pgTable(
  "agent_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    format: text("format").notNull().default("markdown"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: uniqueIndex("agent_outputs_run_id_idx").on(t.runId),
    userIdx: index("agent_outputs_user_id_idx").on(t.userId),
    keyIdx: index("agent_outputs_agent_key_idx").on(t.agentKey),
    projectIdx: index("agent_outputs_project_id_idx").on(t.projectId),
  })
);

// â”€â”€â”€ Navigator â€” Actor-Informed CTEM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const navigatorConfigs = pgTable(
  "navigator_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sector: text("sector").notNull().default("all"),
    crownJewels: jsonb("crown_jewels"),
    riskAppetite: navigatorRiskAppetiteEnum("risk_appetite")
      .notNull()
      .default("balanced"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("navigator_configs_user_id_idx").on(t.userId),
    projectIdx: uniqueIndex("navigator_configs_project_id_idx").on(t.projectId),
  })
);

export const navigatorScenarios = pgTable(
  "navigator_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Deterministic identity for upserts.
    scenarioKey: text("scenario_key").notNull(),

    scenarioType: navigatorScenarioTypeEnum("scenario_type").notNull(),

    actorId: text("actor_id").notNull(),
    actorName: text("actor_name"),

    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetName: text("target_name"),

    // For inferred scenarios: which neighbor actor the technique was inferred from.
    inferredFromActorId: text("inferred_from_actor_id").notNull().default(""),

    title: text("title").notNull(),
    summary: text("summary"),

    rawPriority: doublePrecision("raw_priority").notNull().default(0),
    score: integer("score").notNull().default(0), // 0â€“100 percentile within this user

    primaryTactic: text("primary_tactic"),
    tactics: text("tactics").array(),

    evidenceJson: jsonb("evidence_json"),
    whyJson: jsonb("why_json"),
    attributes: jsonb("attributes"),

    validationStatus: navigatorScenarioValidationStatusEnum("validation_status")
      .notNull()
      .default("unvalidated"),

    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyIdx: uniqueIndex("navigator_scenarios_key_idx").on(t.projectId, t.scenarioKey),
    userIdx: index("navigator_scenarios_user_id_idx").on(t.userId),
    projectIdx: index("navigator_scenarios_project_id_idx").on(t.projectId),
    scoreIdx: index("navigator_scenarios_score_idx").on(t.score),
    typeIdx: index("navigator_scenarios_type_idx").on(t.scenarioType),
    actorIdx: index("navigator_scenarios_actor_id_idx").on(t.actorId),
    targetIdx: index("navigator_scenarios_target_idx").on(t.targetKind, t.targetId),
  })
);

export const navigatorActions = pgTable(
  "navigator_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => navigatorScenarios.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: navigatorActionStatusEnum("status").notNull().default("todo"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("navigator_actions_user_id_idx").on(t.userId),
    projectIdx: index("navigator_actions_project_id_idx").on(t.projectId),
    scenarioIdx: index("navigator_actions_scenario_id_idx").on(t.scenarioId),
    statusIdx: index("navigator_actions_status_idx").on(t.status),
  })
);

export const navigatorDetections = pgTable(
  "navigator_detections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => navigatorScenarios.id, { onDelete: "cascade" }),
    techniqueId: text("technique_id").notNull(),
    techniqueName: text("technique_name"),
    format: navigatorDetectionFormatEnum("format").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("navigator_detections_user_id_idx").on(t.userId),
    projectIdx: index("navigator_detections_project_id_idx").on(t.projectId),
    scenarioIdx: index("navigator_detections_scenario_id_idx").on(t.scenarioId),
    techniqueIdx: index("navigator_detections_technique_id_idx").on(t.techniqueId),
    formatIdx: index("navigator_detections_format_idx").on(t.format),
    uniqueIdx: uniqueIndex("navigator_detections_unique_idx").on(
      t.projectId,
      t.scenarioId,
      t.techniqueId,
      t.format
    ),
  })
);

export const riskEntries = pgTable(
  "risk_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => navigatorScenarios.id, { onDelete: "cascade" }),

    status: riskStatusEnum("status").notNull().default("open"),
    category: riskCategoryEnum("category").notNull().default("operational"),
    owner: text("owner"),
    notes: text("notes"),

    // FAIR-lite estimates (optional): loss event frequency per year × loss magnitude range.
    fairLef: doublePrecision("fair_lef"),
    fairLmLow: integer("fair_lm_low"),
    fairLmHigh: integer("fair_lm_high"),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("risk_entries_user_id_idx").on(t.userId),
    projectIdx: index("risk_entries_project_id_idx").on(t.projectId),
    scenarioIdx: index("risk_entries_scenario_id_idx").on(t.scenarioId),
    statusIdx: index("risk_entries_status_idx").on(t.status),
    userScenarioIdx: uniqueIndex("risk_entries_user_scenario_id_idx").on(
      t.projectId,
      t.scenarioId
    ),
  })
);

export const riskToleranceProfiles = pgTable(
  "risk_tolerance_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    operationalThreshold: integer("operational_threshold").notNull().default(60),
    financialThreshold: integer("financial_threshold").notNull().default(60),
    complianceThreshold: integer("compliance_threshold").notNull().default(50),
    reputationalThreshold: integer("reputational_threshold").notNull().default(50),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("risk_tolerance_profiles_user_id_idx").on(t.userId),
    projectIdx: uniqueIndex("risk_tolerance_profiles_project_id_idx").on(t.projectId),
  })
);

export const complianceMappings = pgTable(
  "compliance_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    framework: complianceFrameworkEnum("framework").notNull(),
    sourceKind: complianceSourceKindEnum("source_kind").notNull(),
    sourceId: text("source_id").notNull(),

    controlId: text("control_id").notNull(),
    controlTitle: text("control_title"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("compliance_mappings_user_id_idx").on(t.userId),
    projectIdx: index("compliance_mappings_project_id_idx").on(t.projectId),
    frameworkIdx: index("compliance_mappings_framework_idx").on(t.framework),
    sourceIdx: index("compliance_mappings_source_idx").on(t.sourceKind, t.sourceId),
    uniqueIdx: uniqueIndex("compliance_mappings_unique_idx").on(
      t.projectId,
      t.framework,
      t.sourceKind,
      t.sourceId,
      t.controlId
    ),
  })
);

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type UserPreference = typeof userPreferences.$inferSelect;
export type UserStack = typeof userStack.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type JiraAutomationConnection =
  typeof jiraAutomationConnections.$inferSelect;
export type JiraAutomationDelivery = typeof jiraAutomationDeliveries.$inferSelect;
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
export type NavigatorConfig = typeof navigatorConfigs.$inferSelect;
export type NavigatorScenario = typeof navigatorScenarios.$inferSelect;
export type NavigatorAction = typeof navigatorActions.$inferSelect;
export type NavigatorDetection = typeof navigatorDetections.$inferSelect;
export type RiskEntry = typeof riskEntries.$inferSelect;
export type RiskToleranceProfile = typeof riskToleranceProfiles.$inferSelect;
export type ComplianceMapping = typeof complianceMappings.$inferSelect;
export type UserAiKey = typeof userAiKeys.$inferSelect;
export type AgentSetting = typeof agentSettings.$inferSelect;
export type CustomAgent = typeof customAgents.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentRunEvent = typeof agentRunEvents.$inferSelect;
export type AgentOutput = typeof agentOutputs.$inferSelect;
