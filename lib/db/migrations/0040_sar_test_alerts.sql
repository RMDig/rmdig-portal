CREATE TABLE "sar_test_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"node" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"test_id" text,
	"error_code" text,
	"avserv_node" text,
	"sent_at" timestamp with time zone,
	"portal_result" text,
	"portal_detail" text,
	"email_result" text,
	"email_detail" text,
	"code_hash" text,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"portal_received_at" timestamp with time zone,
	"portal_received_by_user_id" uuid,
	"email_confirmed_at" timestamp with time zone,
	"email_confirmed_by_user_id" uuid,
	CONSTRAINT "sar_test_alerts_answer" CHECK ((test_id IS NULL) = (code_hash IS NULL) AND (test_id IS NULL OR error_code IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sar_test_alerts" ADD CONSTRAINT "sar_test_alerts_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_test_alerts" ADD CONSTRAINT "sar_test_alerts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_test_alerts" ADD CONSTRAINT "sar_test_alerts_portal_received_by_user_id_users_id_fk" FOREIGN KEY ("portal_received_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_test_alerts" ADD CONSTRAINT "sar_test_alerts_email_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("email_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sar_test_alerts_run_node" ON "sar_test_alerts" USING btree ("run_id","node");--> statement-breakpoint
CREATE UNIQUE INDEX "sar_test_alerts_test_id" ON "sar_test_alerts" USING btree ("test_id") WHERE test_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sar_test_alerts_org_idx" ON "sar_test_alerts" USING btree ("org_id","requested_at");