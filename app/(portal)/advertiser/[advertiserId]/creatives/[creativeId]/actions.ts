"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adCreativeStatusLog,
  advertiserAccounts,
  userPlatformRoles,
  users,
} from "@/lib/db/schema";
import { sendAdCreativePendingReviewEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { portalUrl } from "@/lib/email/links";

// Submit a creative for operator review (AD-P5, docs/plans/30 §5). Advertiser
// member gated (re-checked, never trusting the page). Valid only from `draft` or
// `rejected` (a resubmit). Flips the creative to `pending`, stamps submittedAt,
// clears the prior review note, logs the `submitted` transition, and notifies the
// operators. `advertiserId`/`creativeId` are bound by the form.

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitCreativeForReviewAction(
  advertiserId: string,
  creativeId: string,
  _prev: SubmitResult | null,
  _formData: FormData,
): Promise<SubmitResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await isAdvertiserMember(userId, advertiserId))) {
    return { ok: false, error: "You don't have access to this advertiser account." };
  }

  // Load the creative + prove it belongs to THIS advertiser (join through campaign),
  // and pull the advertiser name/status for the notification + active check.
  const [row] = await db
    .select({
      status: adCreatives.status,
      headline: adCreatives.headline,
      advertiserId: adCampaigns.advertiserId,
      advertiserName: advertiserAccounts.name,
      advertiserStatus: advertiserAccounts.status,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!row || row.advertiserId !== advertiserId) {
    return { ok: false, error: "That creative no longer exists." };
  }
  if (row.advertiserStatus !== "active") {
    return { ok: false, error: "This advertiser account is suspended." };
  }
  if (row.status !== "draft" && row.status !== "rejected") {
    return {
      ok: false,
      error:
        row.status === "pending"
          ? "This creative is already under review."
          : `A ${row.status} creative can't be submitted.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(adCreatives)
        .set({ status: "pending", submittedAt: new Date(), reviewNote: null })
        .where(eq(adCreatives.id, creativeId));
      await tx.insert(adCreativeStatusLog).values({
        creativeId,
        action: "submitted",
        fromStatus: row.status,
        toStatus: "pending",
        actorUserId: userId,
      });
    });
  } catch (err) {
    logger.error({ event: "advertiser.creative.submit_failed", userId, creativeId, err });
    return { ok: false, error: "Couldn't submit the creative. Try again in a moment." };
  }

  logger.info({ event: "advertiser.creative.submitted", userId, advertiserId, creativeId });

  // Notify operators outside the transaction — a mail hiccup must not undo a
  // recorded submission. Failures logged, never fatal.
  await notifyOperators(creativeId, row.advertiserName, row.headline);

  revalidatePath(`/advertiser/${advertiserId}/creatives/${creativeId}`);
  revalidatePath(`/advertiser/${advertiserId}/creatives`);
  return { ok: true };
}

async function notifyOperators(
  creativeId: string,
  advertiserName: string,
  headline: string,
): Promise<void> {
  const reviewUrl = portalUrl(`/admin/ad-approvals`);

  // Reviewers are platform staff: rmdig_admin OR rmdig_reviewer (the reviewer role
  // was broadened to cover creative approval, schema comment + docs/plans/30 §3).
  let reviewers: { email: string }[];
  try {
    reviewers = await db
      .selectDistinct({ email: users.email })
      .from(userPlatformRoles)
      .innerJoin(users, eq(users.id, userPlatformRoles.userId));
  } catch (err) {
    logger.error({ event: "advertiser.creative.reviewer_lookup_failed", creativeId, err });
    return;
  }

  for (const reviewer of reviewers) {
    try {
      await sendAdCreativePendingReviewEmail(reviewer.email, { advertiserName, headline, reviewUrl });
    } catch (err) {
      logger.error({
        event: "advertiser.creative.reviewer_email_failed",
        creativeId,
        to: reviewer.email,
        err,
      });
    }
  }
}
