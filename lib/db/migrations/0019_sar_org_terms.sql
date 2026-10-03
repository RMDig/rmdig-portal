CREATE TYPE "public"."sar_terms_status" AS ENUM('draft', 'submitted', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE "sar_org_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer,
	"body" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"sha256" text,
	"status" "sar_terms_status" DEFAULT 'draft' NOT NULL,
	"author_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"published_at" timestamp with time zone,
	"requires_reacceptance" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sar_org_terms" ADD CONSTRAINT "sar_org_terms_org_id_sar_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sar_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_terms" ADD CONSTRAINT "sar_org_terms_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_org_terms" ADD CONSTRAINT "sar_org_terms_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sar_org_terms_org_version" ON "sar_org_terms" USING btree ("org_id","version") WHERE version IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sar_org_terms_one_open" ON "sar_org_terms" USING btree ("org_id") WHERE status IN ('draft', 'submitted');--> statement-breakpoint
CREATE INDEX "sar_org_terms_status_idx" ON "sar_org_terms" USING btree ("status");--> statement-breakpoint
-- A published terms version is a record users accepted by its hash: it must
-- never change. Only clearing the author/reviewer (ON DELETE SET NULL when a
-- user account is deleted) is allowed.
CREATE FUNCTION sar_org_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND (
    NEW.org_id, NEW.version, NEW.body, NEW.capabilities, NEW.sha256, NEW.status, NEW.published_at, NEW.requires_reacceptance
  ) IS DISTINCT FROM (
    OLD.org_id, OLD.version, OLD.body, OLD.capabilities, OLD.sha256, OLD.status, OLD.published_at, OLD.requires_reacceptance
  ) THEN
    RAISE EXCEPTION 'sar_org_terms %: a published terms version is immutable', OLD.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sar_org_terms_immutable BEFORE UPDATE ON sar_org_terms
  FOR EACH ROW EXECUTE FUNCTION sar_org_terms_immutable();
