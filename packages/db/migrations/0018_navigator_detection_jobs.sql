DO $$ BEGIN
 CREATE TYPE "public"."navigator_detection_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_detection_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"technique_id" text NOT NULL,
	"formats" jsonb NOT NULL,
	"status" "navigator_detection_job_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detection_jobs" ADD CONSTRAINT "navigator_detection_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detection_jobs" ADD CONSTRAINT "navigator_detection_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detection_jobs" ADD CONSTRAINT "navigator_detection_jobs_scenario_id_navigator_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."navigator_scenarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detection_jobs_project_id_idx" ON "navigator_detection_jobs" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detection_jobs_scenario_id_idx" ON "navigator_detection_jobs" ("scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detection_jobs_technique_id_idx" ON "navigator_detection_jobs" ("technique_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detection_jobs_status_created_idx" ON "navigator_detection_jobs" ("status","created_at");--> statement-breakpoint
