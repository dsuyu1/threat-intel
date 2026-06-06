ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "fair_lef" double precision;
--> statement-breakpoint
ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "fair_lm_low" integer;
--> statement-breakpoint
ALTER TABLE "risk_entries" ADD COLUMN IF NOT EXISTS "fair_lm_high" integer;

