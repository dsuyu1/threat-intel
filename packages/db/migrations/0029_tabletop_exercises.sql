-- Tabletop Exercise Generator + In-App Runner (v1)

DO $$ BEGIN
 CREATE TYPE "public"."tabletop_exercise_status" AS ENUM('draft', 'scheduled', 'in_progress', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tabletop_scenario_type" AS ENUM('ransomware', 'supply_chain', 'insider', 'apt', 'nation_state', 'bcs');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tabletop_difficulty_level" AS ENUM('beginner', 'intermediate', 'advanced');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tabletop_session_status" AS ENUM('scheduled', 'in_progress', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tabletop_finding_severity" AS ENUM('low', 'medium', 'high', 'critical');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tabletop_finding_status" AS ENUM('open', 'in_progress', 'resolved');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_exercises" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" "tabletop_exercise_status" DEFAULT 'draft' NOT NULL,
  "scenario_type" "tabletop_scenario_type" NOT NULL,
  "actor_id" text NOT NULL,
  "actor_name" text NOT NULL,
  "difficulty_level" "tabletop_difficulty_level" NOT NULL,
  "duration_minutes" integer NOT NULL,
  "compliance_tag" text,
  "narrative" text NOT NULL,
  "facilitator_guide" text NOT NULL,
  "generation_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp with time zone,
  "scheduled_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_injects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exercise_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "t_plus_minutes" integer NOT NULL,
  "title" text NOT NULL,
  "situation" text NOT NULL,
  "attack_technique_id" text,
  "discussion_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evaluation_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "curveballs" jsonb,
  "facilitator_tips" text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exercise_id" uuid NOT NULL,
  "role_name" text NOT NULL,
  "briefing" text NOT NULL,
  "key_responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "documents_to_have" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exercise_id" uuid NOT NULL,
  "facilitator_user_id" uuid NOT NULL,
  "status" "tabletop_session_status" DEFAULT 'scheduled' NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "current_sequence" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_session_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role_name" text NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_session_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "inject_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role_name" text NOT NULL,
  "response" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tabletop_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "inject_id" uuid,
  "gap" text NOT NULL,
  "severity" "tabletop_finding_severity" NOT NULL,
  "assigned_to" text,
  "due_date" timestamp with time zone,
  "linked_navigator_scenario_id" uuid,
  "status" "tabletop_finding_status" DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tabletop_exercises" ADD CONSTRAINT "tabletop_exercises_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_exercises" ADD CONSTRAINT "tabletop_exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tabletop_injects" ADD CONSTRAINT "tabletop_injects_exercise_id_tabletop_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."tabletop_exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_roles" ADD CONSTRAINT "tabletop_roles_exercise_id_tabletop_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."tabletop_exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_sessions" ADD CONSTRAINT "tabletop_sessions_exercise_id_tabletop_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."tabletop_exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_sessions" ADD CONSTRAINT "tabletop_sessions_facilitator_user_id_users_id_fk" FOREIGN KEY ("facilitator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tabletop_session_participants" ADD CONSTRAINT "tabletop_session_participants_session_id_tabletop_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tabletop_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_session_participants" ADD CONSTRAINT "tabletop_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tabletop_session_responses" ADD CONSTRAINT "tabletop_session_responses_session_id_tabletop_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tabletop_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_session_responses" ADD CONSTRAINT "tabletop_session_responses_inject_id_tabletop_injects_id_fk" FOREIGN KEY ("inject_id") REFERENCES "public"."tabletop_injects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_session_responses" ADD CONSTRAINT "tabletop_session_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tabletop_findings" ADD CONSTRAINT "tabletop_findings_session_id_tabletop_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tabletop_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_findings" ADD CONSTRAINT "tabletop_findings_inject_id_tabletop_injects_id_fk" FOREIGN KEY ("inject_id") REFERENCES "public"."tabletop_injects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "tabletop_findings" ADD CONSTRAINT "tabletop_findings_linked_navigator_scenario_id_navigator_scenarios_id_fk" FOREIGN KEY ("linked_navigator_scenario_id") REFERENCES "public"."navigator_scenarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tabletop_exercises_project_id_idx" ON "tabletop_exercises" ("project_id");
CREATE INDEX IF NOT EXISTS "tabletop_exercises_status_idx" ON "tabletop_exercises" ("project_id", "status");

CREATE INDEX IF NOT EXISTS "tabletop_injects_exercise_id_idx" ON "tabletop_injects" ("exercise_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tabletop_injects_exercise_sequence_idx" ON "tabletop_injects" ("exercise_id", "sequence");

CREATE INDEX IF NOT EXISTS "tabletop_roles_exercise_id_idx" ON "tabletop_roles" ("exercise_id");

CREATE INDEX IF NOT EXISTS "tabletop_sessions_exercise_id_idx" ON "tabletop_sessions" ("exercise_id");
CREATE INDEX IF NOT EXISTS "tabletop_sessions_status_idx" ON "tabletop_sessions" ("status");

CREATE INDEX IF NOT EXISTS "tabletop_session_participants_session_id_idx" ON "tabletop_session_participants" ("session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tabletop_session_participants_session_user_idx" ON "tabletop_session_participants" ("session_id", "user_id");

CREATE INDEX IF NOT EXISTS "tabletop_session_responses_session_id_idx" ON "tabletop_session_responses" ("session_id");
CREATE INDEX IF NOT EXISTS "tabletop_session_responses_inject_id_idx" ON "tabletop_session_responses" ("inject_id");
CREATE INDEX IF NOT EXISTS "tabletop_session_responses_user_id_idx" ON "tabletop_session_responses" ("user_id");

CREATE INDEX IF NOT EXISTS "tabletop_findings_session_id_idx" ON "tabletop_findings" ("session_id");
CREATE INDEX IF NOT EXISTS "tabletop_findings_inject_id_idx" ON "tabletop_findings" ("inject_id");
CREATE INDEX IF NOT EXISTS "tabletop_findings_status_idx" ON "tabletop_findings" ("status");

