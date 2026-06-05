import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { mfaRecoveryCodes } from "../db/schema";
import { hashRecoveryCode, verifyTotp } from "./mfa";

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

  // TOTP first — the common case, and it mutates nothing.
  if (await verifyTotp(secret, cleaned)) return true;

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
