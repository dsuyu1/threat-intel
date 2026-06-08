-- Vulnerability scanner integrations (Tenable / Qualys / Rapid7).

DO $$ BEGIN
 CREATE TYPE "public"."vuln_scanner_kind" AS ENUM('tenable', 'qualys', 'rapid7');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vuln_scanner_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "vuln_scanner_kind" NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "base_url" text NOT NULL,
  "credentials_enc" text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "vuln_scanner_connections" ADD CONSTRAINT "vuln_scanner_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vuln_scanner_connections" ADD CONSTRAINT "vuln_scanner_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vuln_scanner_connections_user_id_idx" ON "vuln_scanner_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_connections_project_id_idx" ON "vuln_scanner_connections" ("project_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_connections_enabled_idx" ON "vuln_scanner_connections" ("enabled");
CREATE INDEX IF NOT EXISTS "vuln_scanner_connections_kind_idx" ON "vuln_scanner_connections" ("kind");
CREATE UNIQUE INDEX IF NOT EXISTS "vuln_scanner_connections_project_name_idx" ON "vuln_scanner_connections" ("project_id","name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vuln_scanner_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "external_id" text,
  "asset_key" text NOT NULL,
  "hostname" text,
  "ipv4" text,
  "os" text,
  "last_seen_at" timestamp with time zone,
  "raw_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "vuln_scanner_assets" ADD CONSTRAINT "vuln_scanner_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vuln_scanner_assets" ADD CONSTRAINT "vuln_scanner_assets_connection_id_vuln_scanner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vuln_scanner_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vuln_scanner_assets_project_id_idx" ON "vuln_scanner_assets" ("project_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_assets_connection_id_idx" ON "vuln_scanner_assets" ("connection_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_assets_last_seen_at_idx" ON "vuln_scanner_assets" ("last_seen_at");
CREATE UNIQUE INDEX IF NOT EXISTS "vuln_scanner_assets_unique_idx" ON "vuln_scanner_assets" ("connection_id","asset_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vuln_scanner_asset_cves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "cve_id" text NOT NULL,
  "scanner_vuln_id" text,
  "severity" text,
  "status" text,
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "raw_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "vuln_scanner_asset_cves" ADD CONSTRAINT "vuln_scanner_asset_cves_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vuln_scanner_asset_cves" ADD CONSTRAINT "vuln_scanner_asset_cves_connection_id_vuln_scanner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vuln_scanner_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vuln_scanner_asset_cves" ADD CONSTRAINT "vuln_scanner_asset_cves_asset_id_vuln_scanner_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."vuln_scanner_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vuln_scanner_asset_cves_project_id_idx" ON "vuln_scanner_asset_cves" ("project_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_asset_cves_connection_id_idx" ON "vuln_scanner_asset_cves" ("connection_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_asset_cves_cve_id_idx" ON "vuln_scanner_asset_cves" ("cve_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_asset_cves_last_seen_at_idx" ON "vuln_scanner_asset_cves" ("last_seen_at");
CREATE UNIQUE INDEX IF NOT EXISTS "vuln_scanner_asset_cves_unique_idx" ON "vuln_scanner_asset_cves" ("asset_id","cve_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vuln_scanner_cve_exposures" (
  "project_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "cve_id" text NOT NULL,
  "affected_host_count" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone,
  "sample_hosts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vuln_scanner_cve_exposures_pkey" PRIMARY KEY ("project_id","connection_id","cve_id")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "vuln_scanner_cve_exposures" ADD CONSTRAINT "vuln_scanner_cve_exposures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vuln_scanner_cve_exposures" ADD CONSTRAINT "vuln_scanner_cve_exposures_connection_id_vuln_scanner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vuln_scanner_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vuln_scanner_cve_exposures_project_id_idx" ON "vuln_scanner_cve_exposures" ("project_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_cve_exposures_connection_id_idx" ON "vuln_scanner_cve_exposures" ("connection_id");
CREATE INDEX IF NOT EXISTS "vuln_scanner_cve_exposures_cve_id_idx" ON "vuln_scanner_cve_exposures" ("cve_id");

