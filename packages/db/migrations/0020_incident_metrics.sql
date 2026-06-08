-- Incident metrics + TheHive sync + playbook post-incident reviews.

DO $$ BEGIN
 CREATE TYPE "public"."playbook_review_step_status" AS ENUM('done', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."playbook_review_tool_action_status" AS ENUM('succeeded', 'failed', 'not_used');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "thehive_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "base_url" text NOT NULL,
  "auth_scheme" text DEFAULT 'bearer' NOT NULL,
  "api_key_enc" text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "thehive_connections" ADD CONSTRAINT "thehive_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thehive_connections" ADD CONSTRAINT "thehive_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "thehive_connections_user_id_idx" ON "thehive_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "thehive_connections_project_id_idx" ON "thehive_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "thehive_connections_enabled_idx" ON "thehive_connections" ("enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "thehive_connections_project_name_idx" ON "thehive_connections" ("project_id","name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "source" text DEFAULT 'thehive' NOT NULL,
  "external_id" text NOT NULL,
  "external_number" integer,
  "title" text,
  "status" text,
  "incident_type" "playbook_incident_type",
  "started_at" timestamp with time zone,
  "detected_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "contained_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "external_updated_at" timestamp with time zone,
  "raw_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "incidents_project_id_idx" ON "incidents" ("project_id");
CREATE INDEX IF NOT EXISTS "incidents_incident_type_idx" ON "incidents" ("incident_type");
CREATE INDEX IF NOT EXISTS "incidents_detected_at_idx" ON "incidents" ("detected_at");
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_unique_external_idx" ON "incidents" ("project_id","source","external_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "playbook_incident_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "playbook_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "reviewer_user_id" uuid NOT NULL,
  "notes" text,
  "estimated_total_minutes" integer NOT NULL,
  "actual_total_minutes" integer,
  "total_steps" integer NOT NULL,
  "skipped_steps" integer NOT NULL,
  "total_tool_actions" integer NOT NULL,
  "failed_tool_actions" integer NOT NULL,
  "effectiveness_score" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "playbook_incident_reviews" ADD CONSTRAINT "playbook_incident_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_incident_reviews" ADD CONSTRAINT "playbook_incident_reviews_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_incident_reviews" ADD CONSTRAINT "playbook_incident_reviews_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_incident_reviews" ADD CONSTRAINT "playbook_incident_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "playbook_incident_reviews_project_id_idx" ON "playbook_incident_reviews" ("project_id");
CREATE INDEX IF NOT EXISTS "playbook_incident_reviews_incident_id_idx" ON "playbook_incident_reviews" ("incident_id");
CREATE INDEX IF NOT EXISTS "playbook_incident_reviews_playbook_id_idx" ON "playbook_incident_reviews" ("playbook_id");
CREATE UNIQUE INDEX IF NOT EXISTS "playbook_incident_reviews_unique_idx" ON "playbook_incident_reviews" ("playbook_id","incident_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "playbook_incident_review_steps" (
  "review_id" uuid NOT NULL,
  "step_id" text NOT NULL,
  "step_title" text NOT NULL,
  "status" "playbook_review_step_status" NOT NULL,
  "actual_minutes" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("review_id","step_id")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "playbook_incident_review_steps" ADD CONSTRAINT "playbook_incident_review_steps_review_id_playbook_incident_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."playbook_incident_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_incident_review_steps_status_idx" ON "playbook_incident_review_steps" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "playbook_incident_review_tool_actions" (
  "review_id" uuid NOT NULL,
  "step_id" text NOT NULL,
  "action_index" integer NOT NULL,
  "tool" text NOT NULL,
  "label" text NOT NULL,
  "status" "playbook_review_tool_action_status" NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("review_id","step_id","action_index")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "playbook_incident_review_tool_actions" ADD CONSTRAINT "playbook_incident_review_tool_actions_review_id_playbook_incident_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."playbook_incident_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_incident_review_tool_actions_status_idx" ON "playbook_incident_review_tool_actions" ("status");

