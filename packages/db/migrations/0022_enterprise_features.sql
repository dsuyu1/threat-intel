-- Enterprise features: external API keys + SBOM uploads.

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" text DEFAULT '[]' NOT NULL,
  "rate_limit_per_min" integer DEFAULT 60 NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "api_keys_project_id_idx" ON "api_keys" ("project_id");
CREATE INDEX IF NOT EXISTS "api_keys_key_prefix_idx" ON "api_keys" ("key_prefix");
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "api_key_rate_limits" (
  "api_key_id" uuid NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "api_key_rate_limits_pk" PRIMARY KEY ("api_key_id","window_start")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "api_key_rate_limits" ADD CONSTRAINT "api_key_rate_limits_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "api_key_rate_limits_window_start_idx" ON "api_key_rate_limits" ("window_start");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sboms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "format" text DEFAULT 'unknown' NOT NULL,
  "sha256" text NOT NULL,
  "document" jsonb NOT NULL,
  "component_count" integer DEFAULT 0 NOT NULL,
  "vulnerable_component_count" integer DEFAULT 0 NOT NULL,
  "matched_cve_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "sboms" ADD CONSTRAINT "sboms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "sboms" ADD CONSTRAINT "sboms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "sboms_project_sha256_idx" ON "sboms" ("project_id","sha256");
CREATE INDEX IF NOT EXISTS "sboms_project_id_idx" ON "sboms" ("project_id");
CREATE INDEX IF NOT EXISTS "sboms_user_id_idx" ON "sboms" ("user_id");

