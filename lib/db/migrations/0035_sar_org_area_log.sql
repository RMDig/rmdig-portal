CREATE TABLE "sar_org_area_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_area" jsonb,
	"to_area" jsonb NOT NULL,
	"from_area_km2" double precision,
	"to_area_km2" double precision NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sar_org_area_log" ADD CONSTRAINT "sar_org_area_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_area_log" ADD CONSTRAINT "sar_org_area_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_org_area_log_org_id_idx" ON "sar_org_area_log" USING btree ("org_id");