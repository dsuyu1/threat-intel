DO $$ BEGIN
 CREATE TYPE "public"."ioc_kind" AS ENUM('ipv4','ipv6','domain','url','md5','sha1','sha256');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ioc_source_kind" AS ENUM('manual','taxii');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ioc_taxii_auth_scheme" AS ENUM('none','bearer','basic');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ioc_enrichment_provider" AS ENUM('virustotal','shodan');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ioc_enrichment_job_status" AS ENUM('queued','running','succeeded','failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "iocs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "ioc_kind" NOT NULL,
	"value" text NOT NULL,
	"normalized" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "iocs" ADD CONSTRAINT "iocs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "iocs_project_kind_norm_idx" ON "iocs" ("project_id","kind","normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "iocs_project_kind_idx" ON "iocs" ("project_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "iocs_project_last_seen_idx" ON "iocs" ("project_id","last_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ioc_taxii_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"api_root_url" text NOT NULL,
	"collection_id" text NOT NULL,
	"auth_scheme" "ioc_taxii_auth_scheme" DEFAULT 'none' NOT NULL,
	"api_key_enc" text,
	"username" text,
	"password_enc" text,
	"lookback_days" integer DEFAULT 30 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"next_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_taxii_connections" ADD CONSTRAINT "ioc_taxii_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_taxii_connections" ADD CONSTRAINT "ioc_taxii_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_taxii_connections_project_id_idx" ON "ioc_taxii_connections" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_taxii_connections_enabled_idx" ON "ioc_taxii_connections" ("enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ioc_taxii_connections_project_name_idx" ON "ioc_taxii_connections" ("project_id","name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ioc_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ioc_id" uuid NOT NULL,
	"source_kind" "ioc_source_kind" NOT NULL,
	"connection_id" uuid,
	"external_id" text NOT NULL,
	"external_url" text,
	"confidence" double precision,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"raw_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_sources" ADD CONSTRAINT "ioc_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_sources" ADD CONSTRAINT "ioc_sources_ioc_id_iocs_id_fk" FOREIGN KEY ("ioc_id") REFERENCES "public"."iocs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_sources" ADD CONSTRAINT "ioc_sources_connection_id_ioc_taxii_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ioc_taxii_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ioc_sources_unique_idx" ON "ioc_sources" ("source_kind","connection_id","external_id","ioc_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_sources_ioc_id_idx" ON "ioc_sources" ("ioc_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_sources_project_id_idx" ON "ioc_sources" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ioc_enrichment_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "ioc_enrichment_provider" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"api_key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichment_keys" ADD CONSTRAINT "ioc_enrichment_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichment_keys" ADD CONSTRAINT "ioc_enrichment_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ioc_enrichment_keys_project_provider_idx" ON "ioc_enrichment_keys" ("project_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_enrichment_keys_project_id_idx" ON "ioc_enrichment_keys" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ioc_enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ioc_id" uuid NOT NULL,
	"provider" "ioc_enrichment_provider" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"raw_json" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichments" ADD CONSTRAINT "ioc_enrichments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichments" ADD CONSTRAINT "ioc_enrichments_ioc_id_iocs_id_fk" FOREIGN KEY ("ioc_id") REFERENCES "public"."iocs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ioc_enrichments_ioc_provider_idx" ON "ioc_enrichments" ("ioc_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_enrichments_project_provider_fetched_idx" ON "ioc_enrichments" ("project_id","provider","fetched_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ioc_enrichment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ioc_id" uuid NOT NULL,
	"provider" "ioc_enrichment_provider" NOT NULL,
	"status" "ioc_enrichment_job_status" DEFAULT 'queued' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichment_jobs" ADD CONSTRAINT "ioc_enrichment_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichment_jobs" ADD CONSTRAINT "ioc_enrichment_jobs_ioc_id_iocs_id_fk" FOREIGN KEY ("ioc_id") REFERENCES "public"."iocs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ioc_enrichment_jobs" ADD CONSTRAINT "ioc_enrichment_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_enrichment_jobs_project_id_idx" ON "ioc_enrichment_jobs" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ioc_enrichment_jobs_status_created_idx" ON "ioc_enrichment_jobs" ("status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ioc_enrichment_jobs_active_unique_idx" ON "ioc_enrichment_jobs" ("project_id","ioc_id","provider") WHERE status in ('queued','running');
