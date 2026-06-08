DO $$ BEGIN
 CREATE TYPE "public"."navigator_action_sla_tier" AS ENUM('critical', 'high', 'medium', 'low');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."navigator_action_sla_event_kind" AS ENUM('breached', 'resolved');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "navigator_actions" ADD COLUMN IF NOT EXISTS "sla_tier" "navigator_action_sla_tier" DEFAULT 'high' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_action_sla_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" "navigator_action_sla_event_kind" NOT NULL,
	"due_date" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_action_sla_events" ADD CONSTRAINT "navigator_action_sla_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_action_sla_events" ADD CONSTRAINT "navigator_action_sla_events_action_id_navigator_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."navigator_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_action_sla_events_project_id_idx" ON "navigator_action_sla_events" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_action_sla_events_action_id_idx" ON "navigator_action_sla_events" ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_action_sla_events_kind_at_idx" ON "navigator_action_sla_events" ("kind","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_action_sla_events_unique_idx" ON "navigator_action_sla_events" ("action_id","kind","due_date");

