import { logger } from "@/lib/logger";

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

export async function requireVerifiedOrgPhone(
  rawPhone: string | undefined,
  code: string | undefined,
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
  if (!code?.trim()) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { phoneCode: ["Enter the verification code we texted you."] },
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

// True when err is Postgres unique_violation (23505) — surfaced so the create
// actions can turn a duplicate contact_phone into a friendly field error
// instead of the generic tx-failed message. The neon driver puts the SQLSTATE
// on err.code; some wrappers nest it under cause.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
