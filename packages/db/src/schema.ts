import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserStack = typeof userStack.$inferSelect;
