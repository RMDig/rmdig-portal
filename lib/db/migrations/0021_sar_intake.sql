CREATE TABLE "sar_alert_acks" (
	"org_id" uuid NOT NULL,
	"alert_id" text NOT NULL,
	"acked_by_user_id" uuid,
	"acked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sar_alert_acks_org_id_alert_id_pk" PRIMARY KEY("org_id","alert_id")
);
--> statement-breakpoint
CREATE TABLE "sar_alert_view_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"alert_ids" text[] NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sar_intake_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"capability" text,
	"node" text NOT NULL,
	"drill" boolean NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sar_alert_acks" ADD CONSTRAINT "sar_alert_acks_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_acks" ADD CONSTRAINT "sar_alert_acks_acked_by_user_id_users_id_fk" FOREIGN KEY ("acked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_view_log" ADD CONSTRAINT "sar_alert_view_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_alert_view_log" ADD CONSTRAINT "sar_alert_view_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_intake_messages" ADD CONSTRAINT "sar_intake_messages_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_alert_view_log_org_idx" ON "sar_alert_view_log" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sar_intake_messages_org_alert_idx" ON "sar_intake_messages" USING btree ("org_id","alert_id");