CREATE TABLE IF NOT EXISTS "splunk_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"app" text DEFAULT 'search' NOT NULL,
	"owner" text DEFAULT 'nobody' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "splunk_connections" ADD CONSTRAINT "splunk_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "splunk_connections_user_id_idx" ON "splunk_connections" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "splunk_connections_enabled_idx" ON "splunk_connections" ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "splunk_connections_user_name_idx" ON "splunk_connections" ("user_id","name");

