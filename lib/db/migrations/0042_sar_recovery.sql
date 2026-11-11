ALTER TABLE "sar_org_sync" ADD COLUMN "remedy" text;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "waiting_alerts" integer;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "active_checkouts" integer;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "over_capacity" boolean;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "view_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "view_error" text;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD COLUMN "remedy_notified" text;