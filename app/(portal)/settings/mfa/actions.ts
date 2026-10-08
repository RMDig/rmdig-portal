"use server";

import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import {
  decryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotp,
} from "@/lib/auth/mfa";
import { verifySecondFactor } from "@/lib/auth/mfa-verify";
import { db } from "@/lib/db";
import { mfaRecoveryCodes, users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// MFA management actions (P1.2 PR-B). The login-time challenge is PR-C; these
// cover enrollment confirmation and post-enrollment management.

export type MfaActionResult =
  | { ok: true }
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; error: string };

// Disable and regenerate each take a second factor on an already-open session.
// Without a cap, someone at an unattended signed-in browser could guess TOTP
// codes until one landed and then turn MFA off. One bucket per user covers both
// actions; every attempt counts (a real user does this rarely).
const MFA_MANAGE_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };
const MFA_MANAGE_LIMITED: MfaActionResult = {
  ok: false,
  error: "Too many attempts. Wait 15 minutes and try again.",
};

async function mfaManageAllowed(userId: string, action: "disable" | "regenerate"): Promise<boolean> {
  const rl = await incrementRateLimit(`mfa-manage:${userId}`, MFA_MANAGE_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "mfa.manage_rate_limited", userId, action, attempts: rl.attempts });
  }
  return rl.allowed;
}

// Replace a user's recovery codes with a fresh set, returning the plaintext to
// show once. Caller is responsible for authorization.
async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  await db
    .insert(mfaRecoveryCodes)
    .values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
  return codes;
}

/**
 * Confirm a pending TOTP enrollment: verify the first code against the pending
 * secret, then activate MFA and issue recovery codes (shown once).
 */
export async function confirmMfaEnrollmentAction(
  _prev: MfaActionResult | null,
  formData: FormData,
): Promise<MfaActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const code = String(formData.get("code") ?? "");

  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, enabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.enabledAt) {
    return { ok: false, error: "Two-factor authentication is already enabled." };
  }
  if (!user?.secret) {
    return { ok: false, error: "Start enrollment again — no pending setup was found." };
  }

  const valid = await verifyTotp(decryptSecret(user.secret), code);
  if (!valid) {
    return { ok: false, error: "That code didn't match. Check your authenticator and try again." };
  }

  await db.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, userId));
  const recoveryCodes = await issueRecoveryCodes(userId);

  logger.info({ event: "mfa.enrolled", userId });
  return { ok: true, recoveryCodes };
}

/** Disable MFA. Requires a valid second factor (TOTP or recovery code) so a
 *  walk-up attacker on an open session can't silently turn it off. */
export async function disableMfaAction(
  _prev: MfaActionResult | null,
  formData: FormData,
): Promise<MfaActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const code = String(formData.get("code") ?? "");

  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, enabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.enabledAt || !user.secret) {
    return { ok: false, error: "Two-factor authentication isn't enabled." };
  }

  if (!(await mfaManageAllowed(userId, "disable"))) return MFA_MANAGE_LIMITED;

  const ok = await verifySecondFactor(userId, decryptSecret(user.secret), code);
  if (!ok) {
    return { ok: false, error: "That code didn't match. Try again." };
  }

  await db
    .update(users)
    .set({ totpSecretEncrypted: null, mfaEnabledAt: null })
    .where(eq(users.id, userId));
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));

  logger.info({ event: "mfa.disabled", userId });
  return { ok: true };
}

/** Regenerate recovery codes (invalidates the old set). Requires a second
 *  factor, same as disable. */
export async function regenerateRecoveryCodesAction(
  _prev: MfaActionResult | null,
  formData: FormData,
): Promise<MfaActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const code = String(formData.get("code") ?? "");

  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, enabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.enabledAt || !user.secret) {
    return { ok: false, error: "Two-factor authentication isn't enabled." };
  }

  if (!(await mfaManageAllowed(userId, "regenerate"))) return MFA_MANAGE_LIMITED;

  const ok = await verifySecondFactor(userId, decryptSecret(user.secret), code);
  if (!ok) {
    return { ok: false, error: "That code didn't match. Try again." };
  }

  const recoveryCodes = await issueRecoveryCodes(userId);
  logger.info({ event: "mfa.recovery_codes_regenerated", userId });
  return { ok: true, recoveryCodes };
}
