CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_clerk_org_id_idx" ON "teams" ("clerk_org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_team_id_idx" ON "projects" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_team_slug_idx" ON "projects" ("team_id","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preferences_default_project_id_idx" ON "user_preferences" ("default_project_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_project_id_projects_id_fk" FOREIGN KEY ("default_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Add project_id columns (nullable for backfill)
ALTER TABLE "user_stack" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "jira_automation_connections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "slack_webhook_connections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "discord_webhook_connections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "soar_webhook_connections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "splunk_connections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "custom_agents" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "agent_outputs" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "navigator_configs" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "navigator_scenarios" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "navigator_actions" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "risk_tolerance_profiles" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "compliance_mappings" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint

-- Foreign keys for project_id
DO $$ BEGIN
 ALTER TABLE "user_stack" ADD CONSTRAINT "user_stack_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "jira_automation_connections" ADD CONSTRAINT "jira_automation_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "slack_webhook_connections" ADD CONSTRAINT "slack_webhook_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "discord_webhook_connections" ADD CONSTRAINT "discord_webhook_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "soar_webhook_connections" ADD CONSTRAINT "soar_webhook_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "splunk_connections" ADD CONSTRAINT "splunk_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "navigator_configs" ADD CONSTRAINT "navigator_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "navigator_scenarios" ADD CONSTRAINT "navigator_scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "navigator_actions" ADD CONSTRAINT "navigator_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "navigator_detections" ADD CONSTRAINT "navigator_detections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "risk_entries" ADD CONSTRAINT "risk_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "risk_tolerance_profiles" ADD CONSTRAINT "risk_tolerance_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "compliance_mappings" ADD CONSTRAINT "compliance_mappings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Ensure every user has a personal team + default project (migration/backfill)
INSERT INTO "teams" ("id", "clerk_org_id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), CONCAT('personal:', u."id"::text), 'Personal', now(), now()
FROM "users" u
ON CONFLICT ("clerk_org_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "projects" ("id", "team_id", "slug", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", 'default', 'Default', now(), now()
FROM "teams" t
WHERE t."clerk_org_id" LIKE 'personal:%'
ON CONFLICT ("team_id","slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_preferences" ("user_id", "default_project_id", "created_at", "updated_at")
SELECT u."id", p."id", now(), now()
FROM "users" u
JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
ON CONFLICT ("user_id") DO UPDATE SET
	"default_project_id" = EXCLUDED."default_project_id",
	"updated_at" = now();
--> statement-breakpoint

WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "user_stack" s
SET "project_id" = personal.project_id
FROM personal
WHERE s."project_id" IS NULL AND s."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "jira_automation_connections" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "slack_webhook_connections" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "discord_webhook_connections" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "soar_webhook_connections" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "splunk_connections" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "custom_agents" a
SET "project_id" = personal.project_id
FROM personal
WHERE a."project_id" IS NULL AND a."user_id" = personal.user_id;
--> statement-breakpoint
UPDATE "agent_runs" r
SET "project_id" = a."project_id"
FROM "custom_agents" a
WHERE r."project_id" IS NULL AND r."custom_agent_id" = a."id";
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "agent_runs" r
SET "project_id" = personal.project_id
FROM personal
WHERE r."project_id" IS NULL AND r."user_id" = personal.user_id;
--> statement-breakpoint
UPDATE "agent_outputs" o
SET "project_id" = r."project_id"
FROM "agent_runs" r
WHERE o."project_id" IS NULL AND o."run_id" = r."id";
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "navigator_configs" c
SET "project_id" = personal.project_id
FROM personal
WHERE c."project_id" IS NULL AND c."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "navigator_scenarios" s
SET "project_id" = personal.project_id
FROM personal
WHERE s."project_id" IS NULL AND s."user_id" = personal.user_id;
--> statement-breakpoint
UPDATE "navigator_scenarios"
SET "scenario_key" = regexp_replace("scenario_key", '^u:[^|]+', CONCAT('p:', "project_id"::text))
WHERE "project_id" IS NOT NULL AND "scenario_key" LIKE 'u:%';
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "navigator_actions" a
SET "project_id" = personal.project_id
FROM personal
WHERE a."project_id" IS NULL AND a."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "navigator_detections" d
SET "project_id" = personal.project_id
FROM personal
WHERE d."project_id" IS NULL AND d."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "risk_entries" r
SET "project_id" = personal.project_id
FROM personal
WHERE r."project_id" IS NULL AND r."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "risk_tolerance_profiles" p2
SET "project_id" = personal.project_id
FROM personal
WHERE p2."project_id" IS NULL AND p2."user_id" = personal.user_id;
--> statement-breakpoint
WITH personal AS (
  SELECT u."id" AS user_id, p."id" AS project_id
  FROM "users" u
  JOIN "teams" t ON t."clerk_org_id" = CONCAT('personal:', u."id"::text)
  JOIN "projects" p ON p."team_id" = t."id" AND p."slug" = 'default'
)
UPDATE "compliance_mappings" m
SET "project_id" = personal.project_id
FROM personal
WHERE m."project_id" IS NULL AND m."user_id" = personal.user_id;
--> statement-breakpoint

-- Enforce NOT NULL after backfill
ALTER TABLE "user_stack" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "jira_automation_connections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "slack_webhook_connections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "discord_webhook_connections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "soar_webhook_connections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "splunk_connections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "custom_agents" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "agent_outputs" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "navigator_configs" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "navigator_scenarios" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "navigator_actions" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "navigator_detections" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "risk_entries" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "risk_tolerance_profiles" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "compliance_mappings" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- Indexes for project_id lookups
CREATE INDEX IF NOT EXISTS "user_stack_project_id_idx" ON "user_stack" ("project_id");
CREATE INDEX IF NOT EXISTS "jira_automation_connections_project_id_idx" ON "jira_automation_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "slack_webhook_connections_project_id_idx" ON "slack_webhook_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "discord_webhook_connections_project_id_idx" ON "discord_webhook_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "soar_webhook_connections_project_id_idx" ON "soar_webhook_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "splunk_connections_project_id_idx" ON "splunk_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "custom_agents_project_id_idx" ON "custom_agents" ("project_id");
CREATE INDEX IF NOT EXISTS "agent_runs_project_id_idx" ON "agent_runs" ("project_id");
CREATE INDEX IF NOT EXISTS "agent_outputs_project_id_idx" ON "agent_outputs" ("project_id");
CREATE INDEX IF NOT EXISTS "navigator_scenarios_project_id_idx" ON "navigator_scenarios" ("project_id");
CREATE INDEX IF NOT EXISTS "navigator_actions_project_id_idx" ON "navigator_actions" ("project_id");
CREATE INDEX IF NOT EXISTS "navigator_detections_project_id_idx" ON "navigator_detections" ("project_id");
CREATE INDEX IF NOT EXISTS "risk_entries_project_id_idx" ON "risk_entries" ("project_id");
CREATE INDEX IF NOT EXISTS "compliance_mappings_project_id_idx" ON "compliance_mappings" ("project_id");
--> statement-breakpoint

-- Update unique indexes to be project-scoped
DROP INDEX IF EXISTS "navigator_configs_user_id_idx";
CREATE INDEX IF NOT EXISTS "navigator_configs_user_id_idx" ON "navigator_configs" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_configs_project_id_idx" ON "navigator_configs" ("project_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "navigator_scenarios_key_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_scenarios_key_idx" ON "navigator_scenarios" ("project_id","scenario_key");
--> statement-breakpoint
DROP INDEX IF EXISTS "navigator_detections_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_detections_unique_idx" ON "navigator_detections" ("project_id","scenario_id","technique_id","format");
--> statement-breakpoint
DROP INDEX IF EXISTS "risk_entries_user_scenario_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "risk_entries_user_scenario_id_idx" ON "risk_entries" ("project_id","scenario_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "risk_tolerance_profiles_user_id_idx";
CREATE INDEX IF NOT EXISTS "risk_tolerance_profiles_user_id_idx" ON "risk_tolerance_profiles" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "risk_tolerance_profiles_project_id_idx" ON "risk_tolerance_profiles" ("project_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "compliance_mappings_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_mappings_unique_idx" ON "compliance_mappings" ("project_id","framework","source_kind","source_id","control_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "custom_agents_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "custom_agents_user_name_idx" ON "custom_agents" ("project_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "jira_automation_connections_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "jira_automation_connections_user_name_idx" ON "jira_automation_connections" ("project_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "slack_webhook_connections_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "slack_webhook_connections_user_name_idx" ON "slack_webhook_connections" ("project_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "discord_webhook_connections_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "discord_webhook_connections_user_name_idx" ON "discord_webhook_connections" ("project_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "soar_webhook_connections_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "soar_webhook_connections_user_name_idx" ON "soar_webhook_connections" ("project_id","name");
--> statement-breakpoint
DROP INDEX IF EXISTS "splunk_connections_user_name_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "splunk_connections_user_name_idx" ON "splunk_connections" ("project_id","name");
