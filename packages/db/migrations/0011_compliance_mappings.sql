DO $$ BEGIN
 CREATE TYPE "public"."compliance_framework" AS ENUM('nist_csf_2', 'cis_v8', 'iso_27001');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."compliance_source_kind" AS ENUM('mitigation', 'technique', 'scenario');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"framework" "compliance_framework" NOT NULL,
	"source_kind" "compliance_source_kind" NOT NULL,
	"source_id" text NOT NULL,
	"control_id" text NOT NULL,
	"control_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_mappings" ADD CONSTRAINT "compliance_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_mappings_user_id_idx" ON "compliance_mappings" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_mappings_framework_idx" ON "compliance_mappings" ("framework");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_mappings_source_idx" ON "compliance_mappings" ("source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_mappings_unique_idx" ON "compliance_mappings" ("user_id","framework","source_kind","source_id","control_id");

