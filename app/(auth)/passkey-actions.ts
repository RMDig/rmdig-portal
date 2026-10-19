"use server";

import { authenticationOptions } from "@/lib/auth/passkeys";
import { clientIp } from "@/lib/client-ip";
import type { PasskeyOptionsResult } from "@/components/auth/PasskeyFactorButton";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// Options for the passkey second factor at sign-in (plan 36 §5.4). Before the
// sign-in completes there's no user, so the options name no credentials (the
// browser offers this site's own passkeys) and reveal nothing about an
// account. Unauthenticated, so rate limited per IP.
const OPTIONS_IP_LIMIT = { limit: 30, windowSec: 15 * 60 };

export async function passkeySignInOptionsAction(): Promise<PasskeyOptionsResult> {
  const ip = await clientIp();
  if (!(await incrementRateLimit(`passkey-options-ip:${ip}`, OPTIONS_IP_LIMIT)).allowed) {
    logger.warn({ event: "passkeys.signin_options.rate_limited", ip });
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }
  try {
    return { ok: true, options: await authenticationOptions("signin", null) };
  } catch (err) {
    logger.error({ event: "passkeys.signin_options.failed", err });
    return { ok: false, error: "Passkeys aren't available here right now. Use your code instead." };
  }
}
