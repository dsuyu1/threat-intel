DO $$ BEGIN
 CREATE TYPE "public"."agent_type" AS ENUM('vuln', 'attack', 'ttp', 'exploit', 'malware');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."poc_level" AS ENUM('poc', 'functional', 'itw');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_tier" AS ENUM('free', 'pro');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" "agent_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"raw_data" text,
	"severity" "severity",
	"cvss_score" numeric(4, 1),
	"cvss_vector" text,
	"cve_id" text,
	"mitre_ids" text,
	"tags" text,
	"source_url" text,
	"source_title" text,
	"poc_url" text,
	"poc_level" "poc_level",
	"disclosure_to_exploit_hours" numeric(8, 1),
	"dedup_hash" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_stack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"technology" text NOT NULL,
	"version_range" text,
	"sector" text DEFAULT 'all'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"clerk_id" text NOT NULL,
	"tier" "user_tier" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_stack" ADD CONSTRAINT "user_stack_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_user_finding_idx" ON "alerts" ("user_id","finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "findings_dedup_hash_idx" ON "findings" ("dedup_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_agent_idx" ON "findings" ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_severity_idx" ON "findings" ("severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_cve_id_idx" ON "findings" ("cve_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_published_at_idx" ON "findings" ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_stack_user_id_idx" ON "user_stack" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_id_idx" ON "users" ("clerk_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");