CREATE TABLE "account_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	CONSTRAINT "account_security_events_kind" CHECK ("account_security_events"."kind" IN ('password_changed', 'password_reset', 'mfa_enabled', 'mfa_disabled', 'recovery_codes_regenerated', 'session_revoked', 'sessions_revoked_others'))
);
--> statement-breakpoint
ALTER TABLE "account_security_events" ADD CONSTRAINT "account_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_security_events_user_at_idx" ON "account_security_events" USING btree ("user_id","at");