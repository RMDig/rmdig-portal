CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "account_security_events" DROP CONSTRAINT "account_security_events_kind";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_passkey_id" uuid;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_passkey_id_webauthn_credentials_id_fk" FOREIGN KEY ("auth_passkey_id") REFERENCES "public"."webauthn_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_security_events" ADD CONSTRAINT "account_security_events_kind" CHECK ("account_security_events"."kind" IN ('password_changed', 'password_reset', 'mfa_enabled', 'mfa_disabled', 'recovery_codes_regenerated', 'session_revoked', 'sessions_revoked_others', 'notices_on', 'notices_off', 'passkey_added', 'passkey_removed'));