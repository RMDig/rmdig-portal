CREATE TABLE "sar_org_settings_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"setting" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "max_active_checkouts" integer;--> statement-breakpoint
ALTER TABLE "sar_org_settings_log" ADD CONSTRAINT "sar_org_settings_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_settings_log" ADD CONSTRAINT "sar_org_settings_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_org_settings_log_org_id_idx" ON "sar_org_settings_log" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_max_active_checkouts_range" CHECK ("sar_orgs"."max_active_checkouts" IS NULL OR "sar_orgs"."max_active_checkouts" BETWEEN 1 AND 10000);