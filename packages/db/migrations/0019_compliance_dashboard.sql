DO $$ BEGIN
 CREATE TYPE "public"."compliance_framework_source" AS ENUM('auto', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_controls" (
	"framework" "compliance_framework" NOT NULL,
	"control_id" text NOT NULL,
	"title" text,
	"group_id" text,
	"group_title" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_controls_pk" PRIMARY KEY("framework","control_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_controls_framework_idx" ON "compliance_controls" ("framework");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_controls_sort_idx" ON "compliance_controls" ("framework","sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_compliance_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"federal_funding" boolean DEFAULT false NOT NULL,
	"cyber_insurance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_compliance_settings" ADD CONSTRAINT "project_compliance_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_compliance_frameworks" (
	"project_id" uuid NOT NULL,
	"framework" "compliance_framework" NOT NULL,
	"source" "compliance_framework_source" DEFAULT 'manual' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_compliance_frameworks_pk" PRIMARY KEY("project_id","framework")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_compliance_frameworks" ADD CONSTRAINT "project_compliance_frameworks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_compliance_frameworks_project_id_idx" ON "project_compliance_frameworks" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_compliance_frameworks_framework_idx" ON "project_compliance_frameworks" ("framework");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_compliance_frameworks_required_idx" ON "project_compliance_frameworks" ("project_id","is_required");
--> statement-breakpoint
INSERT INTO "compliance_controls" ("framework","control_id","title","sort_order") VALUES
  ('nist_csf_2','GV','Govern',10),
  ('nist_csf_2','ID','Identify',20),
  ('nist_csf_2','PR','Protect',30),
  ('nist_csf_2','DE','Detect',40),
  ('nist_csf_2','RS','Respond',50),
  ('nist_csf_2','RC','Recover',60),
  ('cis_v8','1','Inventory and Control of Enterprise Assets',10),
  ('cis_v8','2','Inventory and Control of Software Assets',20),
  ('cis_v8','3','Data Protection',30),
  ('cis_v8','4','Secure Configuration of Enterprise Assets and Software',40),
  ('cis_v8','5','Account Management',50),
  ('cis_v8','6','Access Control Management',60),
  ('cis_v8','7','Continuous Vulnerability Management',70),
  ('cis_v8','8','Audit Log Management',80),
  ('cis_v8','9','Email and Web Browser Protections',90),
  ('cis_v8','10','Malware Defenses',100),
  ('cis_v8','11','Data Recovery',110),
  ('cis_v8','12','Network Infrastructure Management',120),
  ('cis_v8','13','Network Monitoring and Defense',130),
  ('cis_v8','14','Security Awareness and Skills Training',140),
  ('cis_v8','15','Service Provider Management',150),
  ('cis_v8','16','Application Software Security',160),
  ('cis_v8','17','Incident Response Management',170),
  ('cis_v8','18','Penetration Testing',180)
ON CONFLICT DO NOTHING;

