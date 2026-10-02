"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { classifyAgreementError, reportAgreementFailure } from "@/lib/agreement/errors";
import { ALERT_NAME_MAX, codePointLength, LEGAL_NAME_MAX, normalizeName } from "@/lib/agreement/names";
import { auth } from "@/lib/auth";
import { putIdentity } from "@/lib/avserv/agreement";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// AvAI identity from the portal (AvServ plan 23; contract account_agreement.md
// rev 2 §4; docs/plans/31 §3). AvServ is the system of record: the legal name
// binds the agreement, and the alert name (AvServ `displayName`) is what alert
// texts carry. Email is never sent — the portal account's email is its
// verified login. The portal checks only lengths; AvServ's answer decides the
// character rules and its message is shown on the field.

export type AvaiIdentityResult =
  | { ok: true; needsAcceptance: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

// Empty means "leave unchanged" (the contract's omitted field); at least one
// name must be given.
function optionalName(max: number, label: string) {
  return z
    .string()
    .transform(normalizeName)
    .refine((s) => codePointLength(s) <= max, `${label} can be at most ${max} characters.`);
}

const identitySchema = z
  .object({
    legalName: optionalName(LEGAL_NAME_MAX, "Your legal name"),
    displayName: optionalName(ALERT_NAME_MAX, "The name on your alerts"),
  })
  .refine((v) => v.legalName !== "" || v.displayName !== "", {
    message: "Enter your legal name or the name on your alerts.",
    path: ["legalName"],
  });

// Generous for a person editing their name; tight enough to stop a loop from
// hammering AvServ.
const IDENTITY_RATE_LIMIT = { limit: 20, windowSec: 60 * 60 };

export async function saveAvaiIdentityAction(
  _prev: AvaiIdentityResult | null,
  formData: FormData,
): Promise<AvaiIdentityResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;

  const parsed = identitySchema.safeParse({
    legalName: formData.get("legalName") ?? "",
    displayName: formData.get("displayName") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted field.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const [row] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.avservAccountId) {
    logger.warn({ event: "avai.identity.no_account", userId });
    return {
      ok: false,
      error: "Your account isn't linked to AvAI yet. Sign out and back in, then try again.",
    };
  }

  const rate = await incrementRateLimit(`avai-identity:${userId}`, IDENTITY_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "avai.identity.rate_limited", userId });
    return { ok: false, error: "Too many changes in a short time. Please try again later." };
  }

  const { legalName, displayName } = parsed.data;
  try {
    const account = await putIdentity(row.avservAccountId, {
      ...(legalName ? { legalName } : {}),
      ...(displayName ? { displayName } : {}),
    });
    revalidatePath("/settings");
    revalidatePath("/settings/agreement");
    // Names are PII: log that it changed, never the values.
    logger.info({ event: "avai.identity.saved", userId, identityVersion: account.identityVersion });
    return { ok: true, needsAcceptance: account.activated && account.agreement.needsAcceptance };
  } catch (err) {
    const failure = classifyAgreementError(err);
    reportAgreementFailure("avai.identity.failed", failure, err, { userId });
    return {
      ok: false,
      error: failure.message,
      ...(failure.field ? { fieldErrors: { [failure.field]: [failure.message] } } : {}),
    };
  }
}
