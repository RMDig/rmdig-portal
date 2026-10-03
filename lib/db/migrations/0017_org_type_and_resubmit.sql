CREATE TYPE "public"."org_type" AS ENUM('sar_team', 'ski_patrol');--> statement-breakpoint
ALTER TYPE "public"."sar_org_action" ADD VALUE 'resubmitted';--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "org_type" "org_type" DEFAULT 'sar_team' NOT NULL;