-- Add OpenVAS/Greenbone as a vulnerability scanner provider.

DO $$ BEGIN
 ALTER TYPE "public"."vuln_scanner_kind" ADD VALUE 'openvas';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

