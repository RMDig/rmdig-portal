-- portal_reader: read-only access to production for operator queries from the
-- repo (`pnpm prod:read`; docs/runbook.md "Read-only production access").
--
-- Run as neondb_owner in the Neon console SQL editor, on the production
-- branch, after the role exists. Idempotent: re-run it after any migration
-- that adds a table or column, because grants are per column and fail closed:
-- a new column stays unreadable until this runs again.
--
-- Credential material is never granted: password hashes, the encrypted TOTP
-- secret, and every token or token hash (sessions, verification, reset,
-- invitations, deletion confirmations, recovery codes, OAuth). A leaked
-- reader URL still exposes PII (emails, names, SAR records), so the URL lives
-- only in a gitignored local file.

GRANT USAGE ON SCHEMA public, drizzle TO portal_reader;
REVOKE CREATE ON SCHEMA public FROM portal_reader;

ALTER ROLE portal_reader CONNECTION LIMIT 3;
ALTER ROLE portal_reader SET default_transaction_read_only = on;
ALTER ROLE portal_reader SET statement_timeout = '30s';
ALTER ROLE portal_reader SET idle_in_transaction_session_timeout = '60s';

DO $$
DECLARE
  denied text[] := ARRAY[
    'password_hash', 'totp_secret_encrypted', 'code_hash', 'token_hash', 'token',
    'sessionToken', 'refresh_token', 'access_token', 'id_token'
  ];
  t record;
  cols text;
BEGIN
  FOR t IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND c.relkind IN ('r', 'p', 'v', 'm')
      -- PostGIS's own tables and views belong to the extension, not the portal.
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    -- Revoking the table privilege also revokes every column privilege, so a
    -- column added to the deny list loses its grant on the next run.
    EXECUTE format('REVOKE ALL ON %I.%I FROM portal_reader', t.nspname, t.relname);
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO cols
      FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> ALL (denied);
    IF cols IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON %I.%I TO portal_reader', cols, t.nspname, t.relname);
    END IF;
  END LOOP;
END $$;
