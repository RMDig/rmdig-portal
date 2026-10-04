ALTER TYPE "public"."sar_org_action" ADD VALUE 'leaving';--> statement-breakpoint
ALTER TYPE "public"."sar_org_action" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."sar_org_action" ADD VALUE 'reverified';--> statement-breakpoint
ALTER TYPE "public"."sar_org_status" ADD VALUE 'leaving';--> statement-breakpoint
ALTER TYPE "public"."sar_org_status" ADD VALUE 'withdrawn';--> statement-breakpoint
CREATE TABLE "sar_org_sync" (
	"org_id" uuid NOT NULL,
	"node" text NOT NULL,
	"revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"usable" boolean,
	"unusable_reason" text,
	"error_code" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "sar_org_sync_org_id_node_pk" PRIMARY KEY("org_id","node")
);
--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "sync_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "leaving_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "reverify_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sar_org_sync" ADD CONSTRAINT "sar_org_sync_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;