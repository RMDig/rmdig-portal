import { createHash, randomBytes } from "node:crypto";

// Password-reset token primitives. The token is high-entropy random (256 bits),
// so a fast hash is the right tool — bcrypt is for low-entropy human passwords;
// it buys nothing here and would only slow the reset path. We email the
// plaintext and persist only its SHA-256 hash (see schema.passwordResetTokens):
// a database read can never be replayed into an account takeover.

/** How long a reset link stays valid. Short by design — a reset is a deliberate,
 *  immediate action. */
export const RESET_TOKEN_TTL_MINUTES = 60;

const TOKEN_BYTES = 32;

export interface GeneratedResetToken {
  /** Plaintext token — goes in the emailed link, never stored. */
  token: string;
  /** SHA-256 hex of the token — what we persist and look up by. */
  tokenHash: string;
  /** Absolute expiry, RESET_TOKEN_TTL_MINUTES from now. */
  expires: Date;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): GeneratedResetToken {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return {
    token,
    tokenHash: hashResetToken(token),
    expires: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
  };
}
