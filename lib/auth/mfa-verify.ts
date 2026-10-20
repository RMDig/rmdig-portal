import { and, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "../db";
import { mfaRecoveryCodes, users } from "../db/schema";
import { logger } from "../logger";
import { hashRecoveryCode, verifyTotpStep } from "./mfa";

/** Record that the code for `step` was used, if it's newer than the last one.
 *  One atomic UPDATE, so two requests racing with the same code can't both win
 *  (plan 36 H3). False means the code (or an older one) was already used. */
export async function claimTotpStep(userId: string, step: number): Promise<boolean> {
  const claimed = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return claimed.length > 0;
}

// Server-side second-factor check shared by MFA management (disable/regenerate)
// and, in PR-C, the login challenge. Accepts EITHER a live TOTP code OR an
// unused recovery code; a matched recovery code is consumed (single-use).
//
// `secret` is the already-decrypted TOTP secret for the user.

export async function verifySecondFactor(
  userId: string,
  secret: string,
  input: string,
): Promise<boolean> {
  const cleaned = input.trim();
  if (!cleaned) return false;

  // TOTP first, the common case. A right code is accepted once: replaying it
  // (or an older one) within its window is refused.
  const step = await verifyTotpStep(secret, cleaned);
  if (step !== null) {
    if (await claimTotpStep(userId, step)) return true;
    logger.warn({ event: "mfa.totp.replayed", userId });
    return false;
  }

  // Otherwise try to consume a recovery code. The IS NULL + WHERE-guarded update
  // makes consumption atomic: a code already spent (or used concurrently) won't
  // match, so it can't be replayed.
  const codeHash = hashRecoveryCode(cleaned);
  const consumed = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCodes.userId, userId),
        eq(mfaRecoveryCodes.codeHash, codeHash),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ userId: mfaRecoveryCodes.userId });

  return consumed.length > 0;
}
