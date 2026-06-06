DO $$ BEGIN
 CREATE TYPE "public"."agent_kind" AS ENUM('system', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_settings" (
	"agent_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_minutes" integer DEFAULT 1440 NOT NULL,
	"definition" jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_key" text NOT NULL,
	"kind" "agent_kind" DEFAULT 'system' NOT NULL,
	"user_id" uuid,
	"custom_agent_id" uuid,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"progress" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_key" text NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_custom_agent_id_custom_agents_id_fk" FOREIGN KEY ("custom_agent_id") REFERENCES "public"."custom_agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_settings_enabled_idx" ON "agent_settings" ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_agents_user_id_idx" ON "custom_agents" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_agents_enabled_idx" ON "custom_agents" ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_agents_user_name_idx" ON "custom_agents" ("user_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_agent_key_idx" ON "agent_runs" ("agent_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_status_idx" ON "agent_runs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_started_at_idx" ON "agent_runs" ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_custom_agent_id_idx" ON "agent_runs" ("custom_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_user_id_idx" ON "agent_runs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_events_run_id_idx" ON "agent_run_events" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_events_at_idx" ON "agent_run_events" ("at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_outputs_run_id_idx" ON "agent_outputs" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outputs_user_id_idx" ON "agent_outputs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outputs_agent_key_idx" ON "agent_outputs" ("agent_key");
