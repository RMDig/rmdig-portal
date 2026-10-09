-- Whether an org in this status holds its contact phone (the unique index
-- below). Rejected and withdrawn are final, so they release it. Compares the
-- status as text: an enum literal like 'withdrawn' can't be used in the same
-- transaction that added the value (0020), and a fresh database applies every
-- migration in one transaction. IMMUTABLE holds as long as these labels are
-- never renamed.
CREATE FUNCTION "sar_org_holds_phone"(s "sar_org_status") RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT s::text NOT IN ('rejected', 'withdrawn') $$;--> statement-breakpoint
DROP INDEX "sar_orgs_contact_phone_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sar_orgs_contact_phone_live_unique" ON "sar_orgs" USING btree ("contact_phone") WHERE contact_phone IS NOT NULL AND sar_org_holds_phone(status);