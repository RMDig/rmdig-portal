// A drill login's address (plan 37 DR3): a plus address at rmdig.ai with a tag
// starting "drill", e.g. ops+drill1@rmdig.ai. One pattern, written to hold the
// same in Postgres (POSIX; the users_drill_email CHECK in lib/db/schema.ts) and
// JavaScript, so the forms refuse an address before the database does.
//
// No imports on purpose: sign-up reads this, and must not pull in the schema.

export const DRILL_EMAIL_PATTERN = String.raw`^[a-z0-9._-]+\+drill[a-z0-9._-]*@rmdig\.ai$`;

/** True for an address in the drill-login shape, which only a drill login may
 *  use: sign-up and real teams' invitations refuse it, so a real account can
 *  never take one first. */
export function isDrillAddress(email: string): boolean {
  return new RegExp(DRILL_EMAIL_PATTERN).test(email.trim().toLowerCase());
}

export const DRILL_ADDRESS_RESERVED = "This address is reserved for RMDig drill logins.";
