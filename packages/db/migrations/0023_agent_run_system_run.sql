-- Make agent run/output attribution explicit.
-- `system_run=true` means "not initiated by a user", so `user_id` is expected to be NULL.

ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "system_run" boolean DEFAULT false NOT NULL;
ALTER TABLE "agent_outputs" ADD COLUMN IF NOT EXISTS "system_run" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Backfill based on existing nullable user_id values.
UPDATE "agent_runs" SET "system_run" = ("user_id" IS NULL);
UPDATE "agent_outputs" SET "system_run" = ("user_id" IS NULL);
--> statement-breakpoint

-- Enforce intent: NULL user_id is only allowed for system runs/outputs.
DO $$ BEGIN
 ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_system_run_user_id_check"
  CHECK (("system_run" AND "user_id" IS NULL) OR (NOT "system_run" AND "user_id" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "agent_outputs"
  ADD CONSTRAINT "agent_outputs_system_run_user_id_check"
  CHECK (("system_run" AND "user_id" IS NULL) OR (NOT "system_run" AND "user_id" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
