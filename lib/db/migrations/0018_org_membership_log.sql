CREATE TYPE "public"."org_membership_action" AS ENUM('joined', 'role_changed', 'removed', 'left', 'invite_revoked');--> statement-breakpoint
CREATE TABLE "org_membership_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"action" "org_membership_action" NOT NULL,
	"subject_user_id" uuid,
	"subject_email" text NOT NULL,
	"from_role" "org_role",
	"to_role" "org_role",
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_membership_log" ADD CONSTRAINT "org_membership_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_membership_log" ADD CONSTRAINT "org_membership_log_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_membership_log" ADD CONSTRAINT "org_membership_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_membership_log_org_id_idx" ON "org_membership_log" USING btree ("org_id");