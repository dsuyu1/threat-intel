DO $$ BEGIN
 CREATE TYPE "public"."risk_status" AS ENUM('open', 'accepted', 'mitigating', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"status" "risk_status" DEFAULT 'open' NOT NULL,
	"owner" text,
	"notes" text,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_entries" ADD CONSTRAINT "risk_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_entries" ADD CONSTRAINT "risk_entries_scenario_id_navigator_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."navigator_scenarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_entries_user_id_idx" ON "risk_entries" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_entries_scenario_id_idx" ON "risk_entries" ("scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_entries_status_idx" ON "risk_entries" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_entries_user_scenario_id_idx" ON "risk_entries" ("user_id","scenario_id");

