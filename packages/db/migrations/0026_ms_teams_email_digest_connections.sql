-- Microsoft Teams webhook connections + email digest connections.

DO $$ BEGIN
 CREATE TYPE "public"."email_digest_frequency" AS ENUM('daily', 'weekly');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ms_teams_webhook_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "webhook_url" text NOT NULL,
  "criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ms_teams_webhook_connections" ADD CONSTRAINT "ms_teams_webhook_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ms_teams_webhook_connections" ADD CONSTRAINT "ms_teams_webhook_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ms_teams_webhook_connections_user_id_idx" ON "ms_teams_webhook_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "ms_teams_webhook_connections_project_id_idx" ON "ms_teams_webhook_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "ms_teams_webhook_connections_enabled_idx" ON "ms_teams_webhook_connections" ("enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "ms_teams_webhook_connections_user_name_idx" ON "ms_teams_webhook_connections" ("project_id","name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_digest_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "frequency" "email_digest_frequency" DEFAULT 'daily' NOT NULL,
  "send_hour" integer DEFAULT 8 NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "email_digest_connections" ADD CONSTRAINT "email_digest_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_digest_connections" ADD CONSTRAINT "email_digest_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_digest_connections_user_id_idx" ON "email_digest_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "email_digest_connections_project_id_idx" ON "email_digest_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "email_digest_connections_enabled_idx" ON "email_digest_connections" ("enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "email_digest_connections_user_name_idx" ON "email_digest_connections" ("project_id","name");

