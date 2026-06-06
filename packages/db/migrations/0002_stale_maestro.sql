DO $$ BEGIN
 CREATE TYPE "public"."navigator_action_status" AS ENUM('todo', 'in_progress', 'done');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."navigator_risk_appetite" AS ENUM('conservative', 'balanced', 'aggressive');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."navigator_scenario_type" AS ENUM('cve', 'technique', 'inferred');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."navigator_scenario_validation_status" AS ENUM('unvalidated', 'in_progress', 'validated', 'not_applicable');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  -- If Navigator tables exist in an older schema (pre scenario_key/actor_name),
  -- drop them so we can recreate with the current v1 schema.
  IF to_regclass('public.navigator_scenarios') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'navigator_scenarios'
         AND column_name = 'scenario_key'
     ) THEN
    DROP TABLE IF EXISTS "public"."navigator_actions" CASCADE;
    DROP TABLE IF EXISTS "public"."navigator_scenarios" CASCADE;
    DROP TABLE IF EXISTS "public"."navigator_configs" CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "navigator_action_status" DEFAULT 'todo' NOT NULL,
	"due_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sector" text DEFAULT 'all' NOT NULL,
	"crown_jewels" jsonb,
	"risk_appetite" "navigator_risk_appetite" DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"scenario_type" "navigator_scenario_type" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"target_name" text,
	"inferred_from_actor_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"raw_priority" double precision DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"primary_tactic" text,
	"tactics" text[],
	"evidence_json" jsonb,
	"why_json" jsonb,
	"attributes" jsonb,
	"validation_status" "navigator_scenario_validation_status" DEFAULT 'unvalidated' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_actions" ADD CONSTRAINT "navigator_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_actions" ADD CONSTRAINT "navigator_actions_scenario_id_navigator_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."navigator_scenarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_configs" ADD CONSTRAINT "navigator_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_scenarios" ADD CONSTRAINT "navigator_scenarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_actions_user_id_idx" ON "navigator_actions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_actions_scenario_id_idx" ON "navigator_actions" ("scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_actions_status_idx" ON "navigator_actions" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_configs_user_id_idx" ON "navigator_configs" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_scenarios_key_idx" ON "navigator_scenarios" ("scenario_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_scenarios_user_id_idx" ON "navigator_scenarios" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_scenarios_score_idx" ON "navigator_scenarios" ("score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_scenarios_type_idx" ON "navigator_scenarios" ("scenario_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_scenarios_actor_id_idx" ON "navigator_scenarios" ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_scenarios_target_idx" ON "navigator_scenarios" ("target_kind","target_id");
