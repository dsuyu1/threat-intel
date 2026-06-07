-- Store user-approved playbook representation (JSON/YAML) alongside parsed JSON.

DO $$ BEGIN
 CREATE TYPE "public"."playbook_content_format" AS ENUM('json', 'yaml');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "playbooks"
  ADD COLUMN IF NOT EXISTS "content_format" "playbook_content_format" DEFAULT 'json' NOT NULL;
--> statement-breakpoint

ALTER TABLE "playbooks"
  ADD COLUMN IF NOT EXISTS "content_text" text;

