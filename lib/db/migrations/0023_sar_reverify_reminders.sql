CREATE TABLE "sar_reverify_reminders" (
	"org_id" uuid NOT NULL,
	"reverify_by" timestamp with time zone NOT NULL,
	"stage" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sar_reverify_reminders_org_id_reverify_by_stage_pk" PRIMARY KEY("org_id","reverify_by","stage")
);
--> statement-breakpoint
ALTER TABLE "sar_reverify_reminders" ADD CONSTRAINT "sar_reverify_reminders_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;