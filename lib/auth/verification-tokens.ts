import { createHash, randomBytes } from "node:crypto";

// Email-verification token primitives, the sibling of reset-tokens.ts (CLAUDE.md
// §7). The token is 256 random bits, so a fast hash is the right tool. We email
// the plaintext and persist only its SHA-256 hex in verification_tokens.token:
// a database read can't be replayed into verifying an address the reader
// doesn't control.
//
// The table is Auth.js's adapter table, but only for its shape: Auth.js reads it
// solely for the Email (magic-link) provider, which this portal doesn't
// configure. Our sign-up flow (app/(auth)/actions.ts) writes it and
// app/api/verify/route.ts reads it, so storing the hash needs no migration.

/** How long a verification link stays valid. */
export const VERIFICATION_TOKEN_TTL_HOURS = 24;

const TOKEN_BYTES = 32;

export interface GeneratedVerificationToken {
  /** Plaintext token — goes in the emailed link, never stored. */
  token: string;
  /** SHA-256 hex of the token — what we persist and look up by. */
  tokenHash: string;
  /** Absolute expiry, VERIFICATION_TOKEN_TTL_HOURS from now. */
  expires: Date;
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateVerificationToken(): GeneratedVerificationToken {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return {
    token,
    tokenHash: hashVerificationToken(token),
    expires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  };
}
