DO $$ BEGIN
 CREATE TYPE "public"."navigator_detection_format" AS ENUM('sigma', 'kql', 'spl');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"technique_id" text NOT NULL,
	"technique_name" text,
	"format" "navigator_detection_format" NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detections" ADD CONSTRAINT "navigator_detections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detections" ADD CONSTRAINT "navigator_detections_scenario_id_navigator_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."navigator_scenarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detections_user_id_idx" ON "navigator_detections" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detections_scenario_id_idx" ON "navigator_detections" ("scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detections_technique_id_idx" ON "navigator_detections" ("technique_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detections_format_idx" ON "navigator_detections" ("format");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "navigator_detections_unique_idx" ON "navigator_detections" ("user_id","scenario_id","technique_id","format");
