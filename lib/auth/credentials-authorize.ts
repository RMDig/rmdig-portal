import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { CredentialsSignin } from "next-auth";
import { z } from "zod";

import { clientIp } from "../client-ip";
import { db } from "../db";
import { users } from "../db/schema";
import { logger } from "../logger";
import { incrementRateLimit, peekRateLimit, resetRateLimit } from "../rate-limit";
import { decryptSecret } from "./mfa";
import { verifySecondFactor } from "./mfa-verify";

// The Credentials provider's authorize(), kept out of lib/auth.ts so it can be
// unit-tested without the NextAuth runtime.

const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  // Optional second factor. Absent on the first submit (password only); present
  // on the resubmit after we signal MFA_REQUIRED. A 6-digit TOTP or a recovery code.
  totp: z.string().optional(),
});

// Three throttles, all checked before the user lookup so timing can't reveal
// whether an account exists:
//
// - Per IP, every attempt: caps one network spraying many addresses. Sized for
//   a NAT'd club or household (two attempts per MFA login).
// - Per address from one IP, every attempt: the tight brute-force cap (bootstrap
//   P1.1's 5 / 15 min). Keyed by IP too, so a stranger's failures can't lock the
//   owner out from the owner's own network. Cleared on success.
// - Per address across all IPs, failures only: bounds a distributed guesser
//   (passwords and TOTP codes alike). Locking an owner out through it takes
//   failures from several networks, since one IP stops at the cap above.
export const SIGNIN_IP_RATE_LIMIT = { limit: 30, windowSec: 15 * 60 };
export const SIGNIN_SOURCE_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };
export const SIGNIN_EMAIL_FAILURE_LIMIT = { limit: 50, windowSec: 60 * 60 };

const TOO_MANY = "Too many sign-in attempts. Try again in a few minutes.";

// CredentialsSignin subclasses carry a `code` that propagates intact to the
// sign-in server action (unlike plain Errors, which get wrapped). The action
// reads the code to drive the two-phase MFA challenge in the UI.
export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}
export class MfaInvalidError extends CredentialsSignin {
  code = "mfa_invalid";
}

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ event: "auth.credentials.invalid_input" });
    return null;
  }
  const { email, password, totp } = parsed.data;

  const ip = await clientIp();
  const ipLimit = await incrementRateLimit(`signin-ip:${ip}`, SIGNIN_IP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    logger.warn({ event: "auth.credentials.ip_rate_limited", ip, attempts: ipLimit.attempts });
    throw new Error(TOO_MANY);
  }
  const sourceKey = `signin:${email}:${ip}`;
  const sourceLimit = await incrementRateLimit(sourceKey, SIGNIN_SOURCE_RATE_LIMIT);
  if (!sourceLimit.allowed) {
    logger.warn({ event: "auth.credentials.rate_limited", email, ip, attempts: sourceLimit.attempts });
    throw new Error(TOO_MANY);
  }
  const failureKey = `signin-fail:${email}`;
  const failures = await peekRateLimit(failureKey, SIGNIN_EMAIL_FAILURE_LIMIT);
  if (!failures.allowed) {
    logger.warn({ event: "auth.credentials.email_failure_limited", email, failures: failures.attempts });
    throw new Error(TOO_MANY);
  }
  const recordFailure = () => incrementRateLimit(failureKey, SIGNIN_EMAIL_FAILURE_LIMIT);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user || !user.passwordHash) {
    logger.info({ event: "auth.credentials.no_user_or_password", email });
    await recordFailure();
    return null;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    logger.info({ event: "auth.credentials.bad_password", userId: user.id });
    await recordFailure();
    return null;
  }

  if (!user.emailVerified) {
    logger.info({ event: "auth.credentials.unverified", userId: user.id });
    throw new Error(
      "Please verify your email before signing in. Check your inbox, or use \"Didn't get your verification email?\" below for a new link.",
    );
  }

  // Second factor (phase two). The password is correct; if MFA is on, the
  // user must also present a current TOTP or an unused recovery code.
  if (user.mfaEnabledAt) {
    const code = totp?.trim();
    if (!code) {
      // Password ok, code not yet supplied — tell the UI to ask for it.
      logger.info({ event: "auth.credentials.mfa_required", userId: user.id });
      throw new MfaRequiredError();
    }
    if (!user.totpSecretEncrypted) {
      // Enabled but no secret is an inconsistent state; force re-enrollment
      // rather than silently letting the user past the second factor.
      logger.error({ event: "auth.credentials.mfa_missing_secret", userId: user.id });
      throw new MfaRequiredError();
    }
    const second = await verifySecondFactor(user.id, decryptSecret(user.totpSecretEncrypted), code);
    if (!second) {
      logger.info({ event: "auth.credentials.mfa_invalid", userId: user.id });
      await recordFailure();
      throw new MfaInvalidError();
    }
  }

  // Success — clear this source's window so this login's attempts (and the
  // MFA handshake) don't count against the next one. The address-wide failure
  // count is left to expire: a success here says nothing about failures from
  // other networks.
  await resetRateLimit(sourceKey);

  return {
    id: user.id,
    email: user.email,
    name: user.displayName ?? user.name,
    image: user.image,
  };
}
