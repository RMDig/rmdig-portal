import { logger } from "@/lib/logger";

import { verifyPhoneProof } from "./proof";
import { checkPhoneVerification, normalizeUsPhone, phoneVerificationEnabled } from "./verify";

// Gate an org-creation submit on a verified phone (operator decision
// 2026-08-07): one verified number per org — anti-abuse, plus a real callback
// number for vetting. When Twilio Verify is unconfigured (CI, local dev,
// preview) the gate is OPEN and the raw optional phone passes through
// unchanged — SAR approval (§0) and per-creative ad approval remain the true
// gates; verification narrows the funnel, it doesn't hold it.

export type OrgPhoneResult =
  | { ok: true; phone: string | null }
  | { ok: false; error: string; fieldErrors: Record<string, string[]> };

/** `proof` is what the form's "Verify" step returned (lib/phone/proof.ts): with
 *  a valid one the number is already verified and Twilio isn't asked again.
 *  Without one, the code is checked here, as before the Verify step existed. */
export async function requireVerifiedOrgPhone(
  rawPhone: string | undefined,
  code: string | undefined,
  proof?: { token: string | undefined; userId: string },
): Promise<OrgPhoneResult> {
  if (!phoneVerificationEnabled()) {
    return { ok: true, phone: rawPhone ?? null };
  }

  const phone = normalizeUsPhone(rawPhone ?? "");
  if (!phone) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { contactPhone: ["Enter a valid US phone number (10 digits)."] },
    };
  }
  if (proof?.token) {
    if (verifyPhoneProof(proof.token, proof.userId, phone)) return { ok: true, phone };
    // Expired, or for another number: fall back to the code, if one was sent.
    logger.info({ event: "org.phone_verify.proof_rejected", userId: proof.userId });
  }
  if (!code?.trim()) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: {
        phoneCode: [
          proof?.token
            ? "Your phone verification expired. Text yourself a new code and verify again."
            : "Enter the verification code we texted you.",
        ],
      },
    };
  }

  let approved: boolean;
  try {
    approved = await checkPhoneVerification(phone, code.trim());
  } catch (err) {
    logger.error({ event: "org.phone_verify.check_failed", err });
    return {
      ok: false,
      error: "Couldn't verify the code right now. Try again in a moment.",
      fieldErrors: {},
    };
  }
  if (!approved) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { phoneCode: ["That code didn't match or expired. Request a new one."] },
    };
  }
  return { ok: true, phone };
}
