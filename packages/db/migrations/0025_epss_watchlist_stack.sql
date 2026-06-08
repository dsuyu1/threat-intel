-- EPSS enrichment + Watchlists + Stack correlation

ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "epss_score" numeric(8,6);
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "epss_percentile" numeric(8,6);
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "epss_updated_at" timestamp with time zone;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_finding_stack_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"technology" text NOT NULL,
	"version_range" text,
	"matched_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_finding_stack_matches" ADD CONSTRAINT "project_finding_stack_matches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_finding_stack_matches" ADD CONSTRAINT "project_finding_stack_matches_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_finding_stack_matches_unique_idx" ON "project_finding_stack_matches" ("project_id","finding_id","technology");
CREATE INDEX IF NOT EXISTS "project_finding_stack_matches_project_id_idx" ON "project_finding_stack_matches" ("project_id");
CREATE INDEX IF NOT EXISTS "project_finding_stack_matches_finding_id_idx" ON "project_finding_stack_matches" ("finding_id");
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."watchlist_kind" AS ENUM('actor','cve','technique');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."watchlist_channel" AS ENUM('slack','discord','soar','email');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"kind" "watchlist_kind" NOT NULL,
	"value" text NOT NULL,
	"channel" "watchlist_channel" NOT NULL,
	"connection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_connection_required_chk" CHECK ((("channel" = 'email') AND ("connection_id" IS NULL)) OR (("channel" <> 'email') AND ("connection_id" IS NOT NULL)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "watchlist_items_project_id_idx" ON "watchlist_items" ("project_id");
CREATE INDEX IF NOT EXISTS "watchlist_items_user_id_idx" ON "watchlist_items" ("user_id");
CREATE INDEX IF NOT EXISTS "watchlist_items_enabled_idx" ON "watchlist_items" ("enabled");
CREATE INDEX IF NOT EXISTS "watchlist_items_kind_idx" ON "watchlist_items" ("kind");
CREATE INDEX IF NOT EXISTS "watchlist_items_value_idx" ON "watchlist_items" ("value");
CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_items_unique_idx" ON "watchlist_items" ("project_id","user_id","kind","value","channel","connection_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "watchlist_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_item_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"http_status" integer,
	"error" text,
	"response_body" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "watchlist_deliveries" ADD CONSTRAINT "watchlist_deliveries_watchlist_item_id_watchlist_items_id_fk" FOREIGN KEY ("watchlist_item_id") REFERENCES "public"."watchlist_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "watchlist_deliveries" ADD CONSTRAINT "watchlist_deliveries_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_deliveries_unique_idx" ON "watchlist_deliveries" ("watchlist_item_id","finding_id");
CREATE INDEX IF NOT EXISTS "watchlist_deliveries_watchlist_item_id_idx" ON "watchlist_deliveries" ("watchlist_item_id");
CREATE INDEX IF NOT EXISTS "watchlist_deliveries_finding_id_idx" ON "watchlist_deliveries" ("finding_id");
CREATE INDEX IF NOT EXISTS "watchlist_deliveries_sent_at_idx" ON "watchlist_deliveries" ("sent_at");

