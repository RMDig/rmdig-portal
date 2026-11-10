ALTER TYPE "public"."sar_org_action" ADD VALUE 'drill_registered';--> statement-breakpoint
ALTER TYPE "public"."sar_org_action" ADD VALUE 'drill_activated';--> statement-breakpoint
ALTER TABLE "sar_orgs" ALTER COLUMN "proof_doc_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD COLUMN "is_drill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_drill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_proof_unless_drill" CHECK ("sar_orgs"."is_drill" OR "sar_orgs"."proof_doc_url" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "sar_orgs" ADD CONSTRAINT "sar_orgs_drill_shape" CHECK (NOT "sar_orgs"."is_drill" OR ("sar_orgs"."name" ILIKE '%drill%' AND "sar_orgs"."org_type" = 'sar_team'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_drill_email" CHECK (NOT "users"."is_drill" OR lower("users"."email") ~ '^[a-z0-9._-]+\+drill[a-z0-9._-]*@rmdig\.ai$');--> statement-breakpoint
-- Drill is permanent (plan 37 rule 1; AvServ plan 66 R4): a real team or user
-- never becomes a drill one, and a drill one never becomes real.
CREATE FUNCTION drill_flag_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_drill IS DISTINCT FROM OLD.is_drill THEN
    RAISE EXCEPTION '%.is_drill is set at insert and never changes (row %)', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sar_orgs_drill_immutable BEFORE UPDATE OF is_drill ON sar_orgs
  FOR EACH ROW EXECUTE FUNCTION drill_flag_immutable();
--> statement-breakpoint
CREATE TRIGGER users_drill_immutable BEFORE UPDATE OF is_drill ON users
  FOR EACH ROW EXECUTE FUNCTION drill_flag_immutable();
--> statement-breakpoint
-- Drill and real never mix (plan 37 rule 2): a drill user joins only drill
-- teams, and a drill team accepts only drill users.
CREATE FUNCTION org_membership_drill_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT is_drill FROM users WHERE id = NEW.user_id)
     IS DISTINCT FROM (SELECT is_drill FROM sar_orgs WHERE id = NEW.org_id) THEN
    RAISE EXCEPTION 'a drill user joins only drill teams, and a drill team accepts only drill users (org %, user %)', NEW.org_id, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_memberships_drill_match BEFORE INSERT OR UPDATE OF org_id, user_id ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION org_membership_drill_match();
--> statement-breakpoint
-- A drill user never holds a platform role (plan 37 rule 2): staff are never
-- drill logins, and a drill login never reaches /admin.
CREATE FUNCTION platform_role_not_drill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT is_drill FROM users WHERE id = NEW.user_id) THEN
    RAISE EXCEPTION 'a drill user never holds a platform role (user %)', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_platform_roles_not_drill BEFORE INSERT OR UPDATE OF user_id ON user_platform_roles
  FOR EACH ROW EXECUTE FUNCTION platform_role_not_drill();
