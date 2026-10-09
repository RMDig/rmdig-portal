"use server";

import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { logger } from "@/lib/logger";
import { signPhoneProof } from "@/lib/phone/proof";
import {
  checkPhoneVerification,
  normalizeUsPhone,
  PhoneVerifyError,
  startPhoneVerification,
} from "@/lib/phone/verify";
import { incrementRateLimit } from "@/lib/rate-limit";

// Sends the org-creation phone OTP (shared by the SAR and advertiser forms),
// and checks it early (verifyPhoneCodeAction, below).
// Auth-gated: only signed-in users building an org application ever need it.
// Two limits bound the SMS spend and stop the action being used to bombard a
// number: per-user (who's asking) and per-phone (who's receiving).
const PER_USER_LIMIT = { limit: 5, windowSec: 60 * 60 };
const PER_PHONE_LIMIT = { limit: 3, windowSec: 15 * 60 };

const schema = z.object({ phone: z.string().min(1, "Enter a phone number first.") });

export type SendPhoneCodeResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function sendPhoneCodeAction(
  _prev: SendPhoneCodeResult | null,
  formData: FormData,
): Promise<SendPhoneCodeResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const parsed = schema.safeParse({ phone: formData.get("phone") });
  if (!parsed.success) {
    return { ok: false, error: "Enter a phone number first." };
  }
  const phone = normalizeUsPhone(parsed.data.phone);
  if (!phone) {
    return { ok: false, error: "Enter a valid US phone number (10 digits)." };
  }

  const userRate = await incrementRateLimit(`otp-user:${userId}`, PER_USER_LIMIT);
  if (!userRate.allowed) {
    logger.warn({ event: "org.phone_verify.user_rate_limited", userId });
    return { ok: false, error: "Too many verification codes requested. Try again later." };
  }
  const phoneRate = await incrementRateLimit(`otp-phone:${phone}`, PER_PHONE_LIMIT);
  if (!phoneRate.allowed) {
    logger.warn({ event: "org.phone_verify.phone_rate_limited", userId });
    return { ok: false, error: "Too many codes sent to that number. Try again in a few minutes." };
  }

  try {
    await startPhoneVerification(phone);
  } catch (err) {
    if (err instanceof PhoneVerifyError) {
      logger.error({ event: "org.phone_verify.start_failed", userId, err: err.message });
      return { ok: false, error: "Couldn't send the code right now. Try again in a moment." };
    }
    throw err;
  }

  logger.info({ event: "org.phone_verify.code_sent", userId });
  return { ok: true, message: "Code sent — check your texts." };
}

// Checks the texted code before the application is submitted (the "Verify"
// button). On success it returns a signed proof (lib/phone/proof.ts) that the
// form submits in place of the code, because Twilio won't accept the same code
// twice. Twilio stops a verification after 5 wrong codes; this limit also
// bounds how often one user can ask.
const CHECK_LIMIT = { limit: 10, windowSec: 15 * 60 };

const checkSchema = z.object({
  phone: z.string().min(1),
  code: z.string().trim().min(1).max(12),
});

export type VerifyPhoneCodeResult =
  | { ok: true; phone: string; proof: string; message: string }
  | { ok: false; error: string };

export async function verifyPhoneCodeAction(
  _prev: VerifyPhoneCodeResult | null,
  formData: FormData,
): Promise<VerifyPhoneCodeResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const parsed = checkSchema.safeParse({ phone: formData.get("phone"), code: formData.get("code") });
  if (!parsed.success) {
    return { ok: false, error: "Enter the code we texted you." };
  }
  const phone = normalizeUsPhone(parsed.data.phone);
  if (!phone) {
    return { ok: false, error: "Enter a valid US phone number (10 digits)." };
  }

  const rate = await incrementRateLimit(`otp-check:${userId}`, CHECK_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "org.phone_verify.check_rate_limited", userId });
    return { ok: false, error: "Too many tries. Wait a few minutes, then request a new code." };
  }

  let approved: boolean;
  try {
    approved = await checkPhoneVerification(phone, parsed.data.code);
  } catch (err) {
    if (err instanceof PhoneVerifyError) {
      logger.error({ event: "org.phone_verify.check_failed", userId, err: err.message });
      return { ok: false, error: "Couldn't check the code right now. Try again in a moment." };
    }
    throw err;
  }
  if (!approved) {
    return { ok: false, error: "That code didn't match or expired. Request a new one." };
  }

  logger.info({ event: "org.phone_verify.verified", userId });
  return { ok: true, phone, proof: signPhoneProof(userId, phone), message: "Phone number verified." };
}
