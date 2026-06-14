CREATE TYPE "public"."operating_status" AS ENUM('county_sar', 'state_sar', '501c3', 'nonprofit', 'volunteer_group', 'other');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('admin', 'dispatcher', 'responder');--> statement-breakpoint
CREATE TYPE "public"."sar_org_action" AS ENUM('submitted', 'approved', 'rejected', 'changes_requested', 'suspended', 'reactivated');--> statement-breakpoint
CREATE TYPE "public"."sar_org_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "org_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by_user_id" uuid,
	CONSTRAINT "org_memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sar_org_status_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"action" "sar_org_action" NOT NULL,
	"from_status" "sar_org_status",
	"to_status" "sar_org_status" NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sar_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"region_name" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"operating_status" "operating_status" NOT NULL,
	"operating_status_other" text,
	"proof_doc_url" text NOT NULL,
	"status" "sar_org_status" DEFAULT 'pending' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"review_note" text
);
--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_status_log" ADD CONSTRAINT "sar_org_status_log_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_status_log" ADD CONSTRAINT "sar_org_status_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invitations_org_id_idx" ON "org_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_memberships_user_id_idx" ON "org_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sar_org_status_log_org_id_idx" ON "sar_org_status_log" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sar_orgs_status_idx" ON "sar_orgs" USING btree ("status");--> statement-breakpoint
-- PostGIS service-area polygon for SAR orgs (rmdig-ai docs/plans/06). Hand-added
-- below the generated DDL because Drizzle's pg-core has no geography type, so
-- region_geom is managed via raw SQL and read/written through sql`` in
-- lib/sar/geo.ts. It is absent from lib/db/schema.ts and every drizzle snapshot
-- on purpose: `drizzle-kit generate` only ever diffs schema-vs-snapshot, so a
-- column in neither is never re-emitted or dropped. CREATE EXTENSION is
-- idempotent (IF NOT EXISTS) — production already has PostGIS enabled; this makes
-- ephemeral CI/dev Neon branches self-provision so migrations run anywhere.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "region_geom" geography(Polygon, 4326);--> statement-breakpoint
-- GIST index powers the point-in-polygon routing query (find approved orgs whose
-- region contains a GPS point) that AvServ alert dispatch will lean on later.
CREATE INDEX "sar_orgs_region_geom_idx" ON "sar_orgs" USING GIST ("region_geom");