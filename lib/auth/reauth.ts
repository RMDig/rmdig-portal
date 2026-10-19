import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";
import { logger } from "../logger";
import { incrementRateLimit } from "../rate-limit";
import { decryptSecret } from "./mfa";
import { verifySecondFactor } from "./mfa-verify";

// Proving it's still you, for "recent login" (plan 36 §3.4): the password and,
// when two-factor is on, a code. Shares the `reauth:` budget with the staff
// re-auth in admin/team, so the two surfaces can't be combined to guess faster.
//
// Not Google (S-D3, tested 2026-10-18): with max_age=0 Google only showed its
// account picker, and Auth.js keeps the existing session when an already
// signed-in user signs in again with the same Google account, so nothing proves
// a person is present. An account without a password sets one first through
// the emailed reset link (/forgot-password).

const REAUTH_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };

export interface ReauthOptions {
  password: boolean;
  mfa: boolean;
}

/** Which ways this account can prove itself again. */
export async function reauthOptions(userId: string): Promise<ReauthOptions> {
  const [user] = await db
    .select({ passwordHash: users.passwordHash, mfaEnabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { password: !!user?.passwordHash, mfa: !!user?.mfaEnabledAt };
}

/** null when the password (and code, if two-factor is on) check out; otherwise
 *  the message to show. */
export async function verifyPasswordReauth(
  userId: string,
  input: { password: string; code: string },
): Promise<string | null> {
  const rate = await incrementRateLimit(`reauth:${userId}`, REAUTH_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "auth.reauth.rate_limited", userId });
    return "Too many attempts. Try again in a few minutes.";
  }
  const [user] = await db
    .select({
      passwordHash: users.passwordHash,
      mfaEnabledAt: users.mfaEnabledAt,
      totpSecretEncrypted: users.totpSecretEncrypted,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.passwordHash) {
    return "Your account doesn't have a password yet. Set one first, then confirm here.";
  }
  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    logger.info({ event: "auth.reauth.bad_password", userId });
    return "That password is incorrect.";
  }
  if (user.mfaEnabledAt) {
    if (!user.totpSecretEncrypted) {
      // Enabled with no secret is a broken row, not a user error: refuse loudly.
      logger.error({ event: "auth.reauth.mfa_missing_secret", userId });
      return "Two-factor authentication is misconfigured on your account. Contact support.";
    }
    if (!(await verifySecondFactor(userId, decryptSecret(user.totpSecretEncrypted), input.code))) {
      logger.info({ event: "auth.reauth.bad_code", userId });
      return "That code didn't match. Try again.";
    }
  }
  return null;
}
