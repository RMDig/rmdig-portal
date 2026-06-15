import { createHash, randomBytes } from "node:crypto";

// Org-invitation token primitives — same shape as the password-reset tokens
// (lib/auth/reset-tokens): a high-entropy random token, emailed as plaintext and
// persisted only as a SHA-256 hash (schema.orgInvitations.tokenHash), so a
// database read can never be replayed into an unsolicited org membership. TTL is
// 14 days (rmdig-ai docs/plans/06 §"Member invitation").

export const INVITE_TOKEN_TTL_DAYS = 14;

const TOKEN_BYTES = 32;

export interface GeneratedInviteToken {
  /** Plaintext token — goes in the emailed link / shown once to the inviter. */
  token: string;
  /** SHA-256 hex of the token — what we persist and look up by. */
  tokenHash: string;
  /** Absolute expiry, INVITE_TOKEN_TTL_DAYS from now. */
  expires: Date;
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): GeneratedInviteToken {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expires: new Date(Date.now() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}
