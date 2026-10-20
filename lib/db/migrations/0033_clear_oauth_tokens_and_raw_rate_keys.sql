-- Plan 36 H2: Google's access, refresh and ID tokens were stored at sign-in but
-- never read (Google sign-in is identity only). New links no longer store them
-- (lib/auth/oauth-tokens.ts); this clears the ones already held.
UPDATE "accounts" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "expires_at" = NULL, "session_state" = NULL;--> statement-breakpoint
-- Plan 36 H6: rate-limit keys are now stored with everything after the prefix
-- hashed (lib/rate-limit.ts storedKey). Rows written before hold raw emails,
-- IPs and phone numbers and are never read again; every window starts fresh.
DELETE FROM "rate_limits";
