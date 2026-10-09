"use server";

import { eq } from "drizzle-orm";

import { FEATURE_OFF_ERROR, featureEnabled } from "@/lib/features";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { advertiserAccounts, advertiserMemberships, users } from "@/lib/db/schema";
import { createAdvertiserAccountSchema } from "@/lib/advertiser/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { requireVerifiedOrgPhone } from "@/lib/phone/org-phone";
import { logger } from "@/lib/logger";

// Server action behind /advertiser/new (docs/plans/30 §3). A signed-in,
// email-verified user creates an advertiser account: it persists as an `active`
// advertiser_accounts row and makes the creator the `admin`. Unlike SAR orgs there
// is no submit→approval machine on the account itself — an advertiser is vetted by
// the operator out of band, and the safety-critical gate lives on each creative
// (manual approval, AD-P5), not the account. So nothing this account does reaches
// users without per-creative operator approval. The (portal) layout gates auth/MFA;
// this action re-checks auth + verification because a layout must never be trusted
// to gate a write.

export type CreateAdvertiserResult =
  | { ok: true; advertiserId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createAdvertiserAccountAction(
  _prev: CreateAdvertiserResult | null,
  formData: FormData,
): Promise<CreateAdvertiserResult> {
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  // Email verification is required before any state-changing action. Read it fresh
  // rather than trusting the session token.
  const [account] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) {
    return { ok: false, error: "Your account could not be found. Sign in again." };
  }
  if (!account.emailVerified) {
    return {
      ok: false,
      error: "Verify your email address before creating an advertiser account.",
    };
  }

  const parsed = createAdvertiserAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Verified-phone gate (no-op when Twilio Verify is unconfigured); mirrors
  // /sar/new.
  const phoneGate = await requireVerifiedOrgPhone(data.contactPhone, data.phoneCode, {
    token: data.phoneProof,
    userId,
  });
  if (!phoneGate.ok) {
    return { ok: false, error: phoneGate.error, fieldErrors: phoneGate.fieldErrors };
  }

  // Persist atomically: the account and the creator's admin membership either both
  // land or neither does.
  let advertiserId: string;
  try {
    advertiserId = await db.transaction(async (tx) => {
      const [adv] = await tx
        .insert(advertiserAccounts)
        .values({
          name: data.name,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: phoneGate.phone,
          websiteUrl: data.websiteUrl,
          createdByUserId: userId,
        })
        .returning({ id: advertiserAccounts.id });
      if (!adv) {
        throw new Error("advertiser_accounts insert returned no row");
      }
      await tx
        .insert(advertiserMemberships)
        .values({ advertiserId: adv.id, userId, role: "admin" });
      return adv.id;
    });
  } catch (err) {
    // The only unique index this insert can trip (besides the PK) is the
    // per-phone one — surface it as a field error, not a generic failure.
    if (isUniqueViolation(err)) {
      logger.warn({ event: "advertiser.create.phone_in_use", userId });
      return {
        ok: false,
        error: "Please fix the highlighted fields.",
        fieldErrors: {
          contactPhone: ["This phone number is already registered to another advertiser."],
        },
      };
    }
    logger.error({ event: "advertiser.create.tx_failed", userId, err });
    return { ok: false, error: "Couldn't create the advertiser account. Try again in a moment." };
  }

  logger.info({ event: "advertiser.create.success", userId, advertiserId });
  return { ok: true, advertiserId };
}
