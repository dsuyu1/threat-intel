-- Ensure risk management tables are project-scoped.
-- This is a forward-fix for databases that already applied teams/projects
-- before risk tables existed, leaving risk_* tables without project_id.

-- 1) Add project_id columns (nullable for backfill)
ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "risk_tolerance_profiles" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "compliance_mappings" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint

-- 2) Foreign keys for project_id
DO $$ BEGIN
 ALTER TABLE "risk_entries" ADD CONSTRAINT "risk_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "risk_tolerance_profiles" ADD CONSTRAINT "risk_tolerance_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "compliance_mappings" ADD CONSTRAINT "compliance_mappings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 3) Backfill project_id from user_preferences.default_project_id
UPDATE "risk_entries" re
SET "project_id" = up."default_project_id"
FROM "user_preferences" up
WHERE re."project_id" IS NULL AND up."user_id" = re."user_id";

UPDATE "risk_tolerance_profiles" rp
SET "project_id" = up."default_project_id"
FROM "user_preferences" up
WHERE rp."project_id" IS NULL AND up."user_id" = rp."user_id";

UPDATE "compliance_mappings" cm
SET "project_id" = up."default_project_id"
FROM "user_preferences" up
WHERE cm."project_id" IS NULL AND up."user_id" = cm."user_id";
--> statement-breakpoint

-- Fallback: if anything is still NULL, assign to the earliest project.
UPDATE "risk_entries"
SET "project_id" = (SELECT p."id" FROM "projects" p ORDER BY p."created_at" ASC LIMIT 1)
WHERE "project_id" IS NULL;

UPDATE "risk_tolerance_profiles"
SET "project_id" = (SELECT p."id" FROM "projects" p ORDER BY p."created_at" ASC LIMIT 1)
WHERE "project_id" IS NULL;

UPDATE "compliance_mappings"
SET "project_id" = (SELECT p."id" FROM "projects" p ORDER BY p."created_at" ASC LIMIT 1)
WHERE "project_id" IS NULL;
--> statement-breakpoint

-- 4) Enforce NOT NULL after backfill
ALTER TABLE "risk_entries" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "risk_tolerance_profiles" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "compliance_mappings" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- 5) Deduplicate before switching unique indexes
DELETE FROM "risk_entries" re
USING (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY "project_id","scenario_id" ORDER BY "created_at" ASC, "id" ASC) AS rn
    FROM "risk_entries"
  ) t
  WHERE t.rn > 1
) d
WHERE re."id" = d."id";

DELETE FROM "risk_tolerance_profiles" rp
USING (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY "project_id" ORDER BY "updated_at" DESC, "id" DESC) AS rn
    FROM "risk_tolerance_profiles"
  ) t
  WHERE t.rn > 1
) d
WHERE rp."id" = d."id";

DELETE FROM "compliance_mappings" cm
USING (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY "project_id","framework","source_kind","source_id","control_id" ORDER BY "updated_at" DESC, "id" DESC) AS rn
    FROM "compliance_mappings"
  ) t
  WHERE t.rn > 1
) d
WHERE cm."id" = d."id";
--> statement-breakpoint

-- 6) Indexes for project_id lookups
CREATE INDEX IF NOT EXISTS "risk_entries_project_id_idx" ON "risk_entries" ("project_id");
CREATE INDEX IF NOT EXISTS "compliance_mappings_project_id_idx" ON "compliance_mappings" ("project_id");
--> statement-breakpoint

-- 7) Update unique indexes to be project-scoped (align with schema.ts)
DROP INDEX IF EXISTS "risk_entries_user_scenario_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "risk_entries_user_scenario_id_idx" ON "risk_entries" ("project_id","scenario_id");
--> statement-breakpoint

DROP INDEX IF EXISTS "risk_tolerance_profiles_user_id_idx";
CREATE INDEX IF NOT EXISTS "risk_tolerance_profiles_user_id_idx" ON "risk_tolerance_profiles" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "risk_tolerance_profiles_project_id_idx" ON "risk_tolerance_profiles" ("project_id");
--> statement-breakpoint

DROP INDEX IF EXISTS "compliance_mappings_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_mappings_unique_idx" ON "compliance_mappings" ("project_id","framework","source_kind","source_id","control_id");

