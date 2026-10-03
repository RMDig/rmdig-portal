CREATE TYPE "public"."announcement_action" AS ENUM('created', 'ended');--> statement-breakpoint
CREATE TYPE "public"."announcement_audience" AS ENUM('everyone', 'explorer', 'sar', 'advertiser', 'staff');--> statement-breakpoint
CREATE TYPE "public"."announcement_severity" AS ENUM('info', 'maintenance', 'incident');--> statement-breakpoint
CREATE TABLE "announcement_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"action" "announcement_action" NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"severity" "announcement_severity" NOT NULL,
	"audiences" "announcement_audience"[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_log" ADD CONSTRAINT "announcement_log_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_log" ADD CONSTRAINT "announcement_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_log_announcement_id_idx" ON "announcement_log" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "announcements_live_idx" ON "announcements" USING btree ("ends_at") WHERE ended_at IS NULL;