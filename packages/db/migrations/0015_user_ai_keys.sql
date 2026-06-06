-- User-provided AI keys (BYOK) for running agents on behalf of a user/project.
-- Keys are stored encrypted at rest by the application (api_key_enc).

CREATE TABLE IF NOT EXISTS "user_ai_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text DEFAULT 'openai' NOT NULL,
  "api_key_enc" text NOT NULL,
  "base_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "user_ai_keys" ADD CONSTRAINT "user_ai_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "user_ai_keys" ADD CONSTRAINT "user_ai_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_keys_unique_idx" ON "user_ai_keys" ("project_id","user_id","provider");
CREATE INDEX IF NOT EXISTS "user_ai_keys_user_id_idx" ON "user_ai_keys" ("user_id");
CREATE INDEX IF NOT EXISTS "user_ai_keys_project_id_idx" ON "user_ai_keys" ("project_id");

