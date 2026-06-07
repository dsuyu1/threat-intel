-- Project-scoped incident response playbooks (draft → approved).

DO $$ BEGIN
 CREATE TYPE "public"."playbook_status" AS ENUM('draft', 'approved', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."playbook_incident_type" AS ENUM(
  'vulnerability_exploitation',
  'credential_compromise',
  'ransomware',
  'supply_chain',
  'lateral_movement',
  'data_exfiltration'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."playbook_source_kind" AS ENUM('manual', 'navigator_scenario', 'finding');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "source_kind" "playbook_source_kind" DEFAULT 'manual' NOT NULL,
  "source_id" uuid,
  "incident_type" "playbook_incident_type" NOT NULL,
  "title" text NOT NULL,
  "status" "playbook_status" DEFAULT 'draft' NOT NULL,
  "context_json" jsonb,
  "content_json" jsonb NOT NULL,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "playbooks_project_id_idx" ON "playbooks" ("project_id");
CREATE INDEX IF NOT EXISTS "playbooks_status_idx" ON "playbooks" ("status");
CREATE INDEX IF NOT EXISTS "playbooks_incident_type_idx" ON "playbooks" ("incident_type");

