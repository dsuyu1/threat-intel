-- Source reliability scoring support:
-- - Attribute ingested documents to a source (documents.source_id)
-- - Store reliability score breakdown snapshots for UI/analytics

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "documents"
  ADD CONSTRAINT "documents_source_id_sources_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id")
  ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_source_id_idx" ON "documents" ("source_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "source_reliability_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_days" integer NOT NULL,
	"total_claims" integer NOT NULL,
	"confirmed_claims" integer NOT NULL,
	"confirmation_rate" double precision NOT NULL,
	"avg_delay_hours" double precision,
	"timeliness_score" double precision NOT NULL,
	"matured_claims" integer NOT NULL,
	"false_positive_rate" double precision NOT NULL,
	"reliability" double precision NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "source_reliability_snapshots"
  ADD CONSTRAINT "source_reliability_snapshots_source_id_sources_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id")
  ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_reliability_snapshots_source_id_idx" ON "source_reliability_snapshots" ("source_id");
CREATE INDEX IF NOT EXISTS "source_reliability_snapshots_computed_at_idx" ON "source_reliability_snapshots" ("computed_at");
