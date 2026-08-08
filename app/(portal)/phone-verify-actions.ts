"use server";

import { z } from "zod";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { normalizeUsPhone, PhoneVerifyError, startPhoneVerification } from "@/lib/phone/verify";
import { incrementRateLimit } from "@/lib/rate-limit";

// Sends the org-creation phone OTP (shared by the SAR and advertiser forms).
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
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;

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
