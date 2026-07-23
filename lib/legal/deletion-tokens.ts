import { createHash, randomBytes } from "node:crypto";

// Data-deletion confirmation-token primitives. Mirrors lib/auth/reset-tokens:
// the token is high-entropy random (256 bits) so a fast hash is the right
// tool; we email the plaintext and persist only its SHA-256 hash — a database
// read can never be replayed into confirming (or spoofing) someone's deletion
// request. The email round-trip is what proves the requester controls the
// address whose data they're asking us to delete (Colorado Privacy Act
// authentication-of-request step).

/** How long a deletion confirmation link stays valid. Generous compared to a
 *  password reset — a CPA request is not time-critical and re-requesting is
 *  cheap, but links shouldn't live forever in an inbox. */
export const DELETION_TOKEN_TTL_HOURS = 24;

const TOKEN_BYTES = 32;

export interface GeneratedDeletionToken {
  /** Plaintext token — goes in the emailed link, never stored. */
  token: string;
  /** SHA-256 hex of the token — what we persist and look up by. */
  tokenHash: string;
  /** Absolute expiry, DELETION_TOKEN_TTL_HOURS from now. */
  expires: Date;
}

export function hashDeletionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateDeletionToken(): GeneratedDeletionToken {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return {
    token,
    tokenHash: hashDeletionToken(token),
    expires: new Date(Date.now() + DELETION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  };
}
