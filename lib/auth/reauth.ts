import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";
import { logger } from "../logger";
import { incrementRateLimit } from "../rate-limit";
import { decryptSecret } from "./mfa";
import { verifySecondFactor } from "./mfa-verify";
import { listPasskeys, verifyPasskeyAssertion } from "./passkeys";

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
  /** Has at least one passkey (offered instead of the code). */
  passkey: boolean;
}

/** Which ways this account can prove itself again. */
export async function reauthOptions(userId: string): Promise<ReauthOptions> {
  const [user] = await db
    .select({ passwordHash: users.passwordHash, mfaEnabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const passkey = !!user?.mfaEnabledAt && (await listPasskeys(userId)).length > 0;
  return { password: !!user?.passwordHash, mfa: !!user?.mfaEnabledAt, passkey };
}

export type ReauthCheck =
  | { ok: true; method: "password" | "passkey"; passkeyId: string | null }
  | { ok: false; error: string };

/** The password, then (with two-factor on) a code or one of the user's
 *  passkeys. A passkey makes the session's next revoke a full one once that
 *  passkey is 7 days old (device_revoke rev 2 §1.1). */
export async function verifyPasswordReauth(
  userId: string,
  input: { password: string; code: string; passkey?: string },
): Promise<ReauthCheck> {
  const fail = (error: string): ReauthCheck => ({ ok: false, error });
  const rate = await incrementRateLimit(`reauth:${userId}`, REAUTH_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "auth.reauth.rate_limited", userId });
    return fail("Too many attempts. Try again in a few minutes.");
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
    return fail("Your account doesn't have a password yet. Set one first, then confirm here.");
  }
  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    logger.info({ event: "auth.reauth.bad_password", userId });
    return fail("That password is incorrect.");
  }
  if (user.mfaEnabledAt && input.passkey) {
    const result = await verifyPasskeyAssertion(userId, input.passkey, "reauth");
    if (!result.ok) {
      logger.info({ event: "auth.reauth.bad_passkey", userId });
      return fail("That passkey couldn't be checked. Try again, or use your code.");
    }
    return { ok: true, method: "passkey", passkeyId: result.passkeyId };
  }
  if (user.mfaEnabledAt) {
    if (!user.totpSecretEncrypted) {
      // Enabled with no secret is a broken row, not a user error: refuse loudly.
      logger.error({ event: "auth.reauth.mfa_missing_secret", userId });
      return fail("Two-factor authentication is misconfigured on your account. Contact support.");
    }
    if (!(await verifySecondFactor(userId, decryptSecret(user.totpSecretEncrypted), input.code))) {
      logger.info({ event: "auth.reauth.bad_code", userId });
      return fail("That code didn't match. Try again.");
    }
  }
  return { ok: true, method: "password", passkeyId: null };
}
