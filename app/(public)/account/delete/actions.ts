"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/lib/db";
import { deletionRequests } from "@/lib/db/schema";
import { sendDataDeletionConfirmEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import {
  DELETION_TOKEN_TTL_HOURS,
  generateDeletionToken,
} from "@/lib/legal/deletion-tokens";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// Colorado Privacy Act deletion-request intake (AvApp doc 24 §1.4). Public and
// unauthenticated ON PURPOSE: requests can come from AvAI app users or
// emergency contacts who have no portal account. Proof of control of the email
// address comes from the confirmation round-trip (see confirm/page.tsx), so
// this action doesn't care whether the address matches a user row — which also
// means there is nothing to enumerate.

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
});

// 3 requests/hour per address: a legitimate requester needs exactly one email;
// this only throttles someone spamming a victim's inbox through our form.
const RATE_LIMIT = { limit: 3, windowSec: 60 * 60 };

// 10 requests/hour per client IP, checked BEFORE the per-address limit. Unlike
// password reset, this form emails ANY address (no account-existence gate — a
// CPA request needs none), so without an IP cap an abuser could direct
// confirmation emails at unlimited distinct third-party inboxes at 3/hr each.
// 10/hr still covers a NAT'd household of legitimate requesters.
const IP_RATE_LIMIT = { limit: 10, windowSec: 60 * 60 };

// First hop of x-forwarded-for is the client IP on Vercel (the platform
// appends, so the leftmost entry is what reached the edge). Headerless
// requests (local dev, direct invocation) share one "unknown" bucket rather
// than bypassing the limit — fail closed, not open.
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export type DeletionRequestState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  | null;

export async function requestDataDeletionAction(
  _prev: DeletionRequestState,
  formData: FormData,
): Promise<DeletionRequestState> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the form and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email } = parsed.data;

  const ip = await clientIp();
  const ipRate = await incrementRateLimit(`deletion-ip:${ip}`, IP_RATE_LIMIT);
  if (!ipRate.allowed) {
    logger.warn({ event: "deletion.request.ip_rate_limited", ip });
    return {
      ok: false,
      error: "Too many deletion requests. Try again later.",
    };
  }

  const rate = await incrementRateLimit(`deletion:${email}`, RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "deletion.request.rate_limited", email });
    return {
      ok: false,
      error: "Too many deletion requests for this address. Try again later.",
    };
  }

  const { token, tokenHash, expires } = generateDeletionToken();

  let requestId: string;
  try {
    const [row] = await db
      .insert(deletionRequests)
      .values({ email, tokenHash, tokenExpiresAt: expires })
      .returning({ id: deletionRequests.id });
    if (!row) {
      throw new Error("deletion_requests insert returned no rows");
    }
    requestId = row.id;
  } catch (err) {
    logger.error({ event: "deletion.request.insert_failed", email, err });
    return { ok: false, error: "Couldn't record your request. Try again in a moment." };
  }

  const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
  const confirmUrl = `${baseUrl}/account/delete/confirm?token=${token}`;

  try {
    await sendDataDeletionConfirmEmail(email, {
      confirmUrl,
      expiresInHours: DELETION_TOKEN_TTL_HOURS,
    });
  } catch (err) {
    // Without the confirmation email the flow is dead in the water — surface
    // it rather than showing a success the user can never complete. The
    // pending row is harmless (unconfirmed requests are never worked).
    logger.error({ event: "deletion.request.email_failed", email, requestId, err });
    return {
      ok: false,
      error: "Couldn't send the confirmation email. Try again in a moment.",
    };
  }

  logger.info({ event: "deletion.request.created", requestId });
  return { ok: true };
}
