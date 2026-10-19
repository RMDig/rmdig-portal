CREATE TABLE "security_notice_cursors" (
	"user_id" uuid NOT NULL,
	"node" text NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_notice_cursors_user_id_node_pk" PRIMARY KEY("user_id","node")
);
--> statement-breakpoint
ALTER TABLE "account_security_events" DROP CONSTRAINT "account_security_events_kind";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_notices_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "security_notice_cursors" ADD CONSTRAINT "security_notice_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_security_events" ADD CONSTRAINT "account_security_events_kind" CHECK ("account_security_events"."kind" IN ('password_changed', 'password_reset', 'mfa_enabled', 'mfa_disabled', 'recovery_codes_regenerated', 'session_revoked', 'sessions_revoked_others', 'notices_on', 'notices_off'));