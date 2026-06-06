CREATE TABLE IF NOT EXISTS "jira_automation_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"webhook_url" text NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jira_automation_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"http_status" integer,
	"error" text,
	"response_body" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jira_automation_connections" ADD CONSTRAINT "jira_automation_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jira_automation_deliveries" ADD CONSTRAINT "jira_automation_deliveries_connection_id_jira_automation_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."jira_automation_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jira_automation_deliveries" ADD CONSTRAINT "jira_automation_deliveries_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_automation_connections_user_id_idx" ON "jira_automation_connections" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_automation_connections_enabled_idx" ON "jira_automation_connections" ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jira_automation_connections_user_name_idx" ON "jira_automation_connections" ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jira_automation_delivery_unique_idx" ON "jira_automation_deliveries" ("connection_id","finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_automation_deliveries_finding_id_idx" ON "jira_automation_deliveries" ("finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_automation_deliveries_connection_id_idx" ON "jira_automation_deliveries" ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_automation_deliveries_sent_at_idx" ON "jira_automation_deliveries" ("sent_at");

