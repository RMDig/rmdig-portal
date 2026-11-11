CREATE TABLE "sar_oncall_email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"address" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "sar_oncall_email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "oncall_email" text;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "oncall_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sar_oncall_email_verifications" ADD CONSTRAINT "sar_oncall_email_verifications_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_oncall_email_verifications" ADD CONSTRAINT "sar_oncall_email_verifications_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_oncall_email_verifications_org_id_idx" ON "sar_oncall_email_verifications" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_oncall_email_verified" CHECK (("sar_orgs"."oncall_email" IS NULL) = ("sar_orgs"."oncall_email_verified_at" IS NULL));