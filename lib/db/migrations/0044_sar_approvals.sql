CREATE TYPE "public"."sar_acceptance_mode" AS ENUM('open', 'confirm_first');--> statement-breakpoint
CREATE TABLE "sar_approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"acceptance_id" text NOT NULL,
	"state" text NOT NULL,
	"decided_by_user_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"node_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sar_approval_decisions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "sar_approval_decisions_state" CHECK ("sar_approval_decisions"."state" IN ('approved', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "acceptance_mode" "sar_acceptance_mode" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "sar_approval_decisions" ADD CONSTRAINT "sar_approval_decisions_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_approval_decisions" ADD CONSTRAINT "sar_approval_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sar_approval_decisions_org_id_idx" ON "sar_approval_decisions" USING btree ("org_id");