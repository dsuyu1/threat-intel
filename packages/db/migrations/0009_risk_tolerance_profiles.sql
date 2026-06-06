DO $$ BEGIN
 CREATE TYPE "public"."risk_category" AS ENUM('operational', 'financial', 'compliance', 'reputational');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "category" "risk_category" DEFAULT 'operational' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_tolerance_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operational_threshold" integer DEFAULT 60 NOT NULL,
	"financial_threshold" integer DEFAULT 60 NOT NULL,
	"compliance_threshold" integer DEFAULT 50 NOT NULL,
	"reputational_threshold" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_tolerance_profiles" ADD CONSTRAINT "risk_tolerance_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_tolerance_profiles_user_id_idx" ON "risk_tolerance_profiles" ("user_id");

