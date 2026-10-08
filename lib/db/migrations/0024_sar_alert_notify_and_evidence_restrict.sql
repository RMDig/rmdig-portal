-- The SAR team-email claim table (lib/sar/alert-notify.ts), the review
-- revision staff decisions are checked against (CLAUDE.md §0), the SAR org
-- evidence foreign keys moved from ON DELETE cascade to RESTRICT so deleting
-- an org can't destroy its status log, alerts, acks, view logs or terms, and
-- the rmdig_sar_approver platform role.
--
-- The role is added by rebuilding the platform_role type, not with ALTER TYPE
-- ... ADD VALUE: drizzle runs every pending migration in one transaction, and
-- Postgres refuses to use a value added by ADD VALUE before that transaction
-- commits, which the grant at the end of this file needs to do. A type
-- created in the same transaction carries no such restriction.
ALTER TYPE "public"."platform_role" RENAME TO "platform_role_before_0024";--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('rmdig_admin', 'rmdig_reviewer', 'rmdig_sar_approver');--> statement-breakpoint
ALTER TABLE "user_platform_roles" ALTER COLUMN "role" SET DATA TYPE "public"."platform_role" USING "role"::text::"public"."platform_role";--> statement-breakpoint
ALTER TABLE "platform_role_invitations" ALTER COLUMN "role" SET DATA TYPE "public"."platform_role" USING "role"::text::"public"."platform_role";--> statement-breakpoint
ALTER TABLE "platform_role_log" ALTER COLUMN "role" SET DATA TYPE "public"."platform_role" USING "role"::text::"public"."platform_role";--> statement-breakpoint
DROP TYPE "public"."platform_role_before_0024";--> statement-breakpoint
CREATE TABLE "sar_alert_notifications" (
	"org_id" uuid NOT NULL,
	"alert_id" text NOT NULL,
	"kind" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp with time zone,
	"delivered_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sar_alert_notifications_org_id_alert_id_kind_pk" PRIMARY KEY("org_id","alert_id","kind")
);
--> statement-breakpoint
ALTER TABLE "org_membership_log" DROP CONSTRAINT "org_membership_log_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_alert_acks" DROP CONSTRAINT "sar_alert_acks_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_alert_view_log" DROP CONSTRAINT "sar_alert_view_log_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_intake_messages" DROP CONSTRAINT "sar_intake_messages_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_map_view_log" DROP CONSTRAINT "sar_map_view_log_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_org_status_log" DROP CONSTRAINT "sar_org_status_log_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_org_terms" DROP CONSTRAINT "sar_org_terms_org_id_sar_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "review_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sar_alert_notifications" ADD CONSTRAINT "sar_alert_notifications_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_notifications" ADD CONSTRAINT "sar_alert_notifications_message_id_sar_intake_messages_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."sar_intake_messages"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_alert_notifications_open_idx" ON "sar_alert_notifications" USING btree ("status") WHERE status IN ('pending', 'failed');--> statement-breakpoint
ALTER TABLE "org_membership_log" ADD CONSTRAINT "org_membership_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_acks" ADD CONSTRAINT "sar_alert_acks_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_view_log" ADD CONSTRAINT "sar_alert_view_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_intake_messages" ADD CONSTRAINT "sar_intake_messages_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_map_view_log" ADD CONSTRAINT "sar_map_view_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_status_log" ADD CONSTRAINT "sar_org_status_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_terms" ADD CONSTRAINT "sar_org_terms_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Owner decision (2026-10-07): everyone who is a platform
-- administrator when this runs also becomes a SAR approver, so approvals don't
-- stop at deploy. Logged as a grant with no actor (the migration). From here
-- on only an rmdig_admin grants the role, by invitation (/admin/team).
INSERT INTO "platform_role_log" ("action", "role", "target_email", "target_user_id", "actor_user_id")
SELECT 'granted', 'rmdig_sar_approver', u."email", u."id", NULL
FROM "user_platform_roles" r JOIN "users" u ON u."id" = r."user_id"
WHERE r."role" = 'rmdig_admin'
  AND NOT EXISTS (SELECT 1 FROM "user_platform_roles" x WHERE x."user_id" = r."user_id" AND x."role" = 'rmdig_sar_approver');--> statement-breakpoint
INSERT INTO "user_platform_roles" ("user_id", "role")
SELECT "user_id", 'rmdig_sar_approver' FROM "user_platform_roles" WHERE "role" = 'rmdig_admin'
ON CONFLICT DO NOTHING;
