// The key behind log pseudonyms (plan 36 H6, AvApp plan 56 P7). Its own
// secret, so rotating NEXTAUTH_SECRET no longer changes every email and IP
// pseudonym, and a leak of one doesn't give the other. Pure: no lib/env
// import, so scripts/check-service-key.ts can run it at build time.

/** 32 bytes as hex: `openssl rand -hex 32`. */
export const LOG_PSEUDONYM_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export type LogPseudonymKeyCheck =
  | { status: "ok" }
  | { status: "skipped" }
  | { status: "error"; error: string };

/** The build check. Production must have a well-formed key: a missing one
 *  fails the Vercel build, so the last good deployment keeps serving rather
 *  than a missing log key taking every route down at boot. Elsewhere (local,
 *  CI, previews) unset is fine; present but malformed is an error anywhere. */
export function checkLogPseudonymKeyConfig(e: { VERCEL_ENV?: string; LOG_PSEUDONYM_KEY?: string }): LogPseudonymKeyCheck {
  const key = e.LOG_PSEUDONYM_KEY;
  if (key) {
    return LOG_PSEUDONYM_KEY_PATTERN.test(key)
      ? { status: "ok" }
      : { status: "error", error: "LOG_PSEUDONYM_KEY must be 64 hex characters (openssl rand -hex 32)" };
  }
  if (e.VERCEL_ENV === "production") {
    return { status: "error", error: "LOG_PSEUDONYM_KEY is required in production (runbook \"Key rotation\")" };
  }
  return { status: "skipped" };
}

/** The HMAC key each pseudonym kind derives its own key from. Without
 *  LOG_PSEUDONYM_KEY (only outside production, by the build check above) it is
 *  NEXTAUTH_SECRET, the key every pseudonym used before H6, so local and
 *  preview logs read as they always have. */
export function logPseudonymRoot(e: { LOG_PSEUDONYM_KEY?: string; NEXTAUTH_SECRET: string }): Buffer | string {
  return e.LOG_PSEUDONYM_KEY ? Buffer.from(e.LOG_PSEUDONYM_KEY, "hex") : e.NEXTAUTH_SECRET;
}
