DO $$ BEGIN
 CREATE TYPE "public"."navigator_detection_lifecycle_status" AS ENUM('draft', 'peer_reviewed', 'deployed', 'monitoring', 'retired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "lifecycle_status" "navigator_detection_lifecycle_status" DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "deployed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "navigator_detections" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_detections" ADD CONSTRAINT "navigator_detections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigator_detections_lifecycle_status_idx" ON "navigator_detections" ("lifecycle_status");

