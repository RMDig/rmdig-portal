"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { FEATURE_OFF_ERROR, featureEnabled } from "@/lib/features";
import { portalActor } from "@/lib/auth/portal-actor";
import { canReviewAds } from "@/lib/auth/roles";
import { publishCreative, unpublishCreative } from "@/lib/avserv/client";
import { columnsToAdTarget } from "@/lib/advertiser/target";
import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adCreativeStatusLog,
  advertiserAccounts,
} from "@/lib/db/schema";
import { type AdCreativeDecision } from "@/lib/email/templates/AdCreativeDecisionEmail";
import { portalUrl } from "@/lib/email/links";
import { sendAdCreativeDecisionEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";

// Publish an approved creative to AvServ and record the returned ref + publishedAt.
// Best-effort by contract (docs/plans/30 §9 invariant 5): on failure the creative
// stays approved with published_at = null ("approved, not yet live") — never a
// false "live" — and the failure is logged loudly (no silent failure). Returns
// whether it went live so callers can surface a retry.
async function publishAndRecord(creative: {
  id: string;
  slot: string;
  headline: string;
  body: string;
  altText: string;
  clickUrl: string | null;
  targetKind: "national" | "radius" | "admin";
  targetLat: string | null;
  targetLon: string | null;
  targetRadiusMi: number | null;
  targetAdminLevel: "state" | "county" | "place" | null;
  targetAdminFips: string[] | null;
}): Promise<boolean> {
  try {
    const { avservCreativeRef } = await publishCreative({
      portalCreativeId: creative.id,
      slot: creative.slot,
      headline: creative.headline,
      body: creative.body,
      altText: creative.altText,
      clickUrl: creative.clickUrl,
      target: columnsToAdTarget(creative),
    });
    await db
      .update(adCreatives)
      .set({ publishedAt: new Date(), avservCreativeRef })
      .where(eq(adCreatives.id, creative.id));
    return true;
  } catch (err) {
    logger.error({ event: "ad.publish.failed", creativeId: creative.id, err });
    return false;
  }
}

// Unpublish a creative from AvServ and clear its publish stamps. Best-effort: on
// failure we log loudly (a suspended creative still live is a real problem) but
// don't undo the status change.
async function unpublishAndClear(creativeId: string, ref: string | null): Promise<void> {
  if (!ref) return; // never published — nothing to pull
  try {
    await unpublishCreative(ref);
    await db
      .update(adCreatives)
      .set({ publishedAt: null, avservCreativeRef: null })
      .where(eq(adCreatives.id, creativeId));
  } catch (err) {
    reportError("ad.unpublish.failed", err, { creativeId });
  }
}

// Operator decisions on an ad creative (AD-P5, docs/plans/30 §5/§6). Manual
// approval is non-negotiable for a safety app — only `approved` creatives become
// eligible for the signed manifest (publish wiring lands in AD-P6). Gated to
// rmdig_admin or rmdig_reviewer (AD_REVIEW_ROLES), re-checked here.
// Each decision is valid only from a specific current status; it flips status,
// appends to the append-only ad_creative_status_log, and (for every decision
// but reactivate) emails the advertiser's contact.

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type Decision = "approve" | "reject" | "request_changes" | "suspend" | "reactivate";
type Status = "draft" | "pending" | "approved" | "rejected" | "suspended";
type Action = "approved" | "rejected" | "changes_requested" | "suspended" | "reactivated";

// from-status guard, resulting status, audit action, and whether/what to email.
const TRANSITIONS: Record<
  Decision,
  { from: Status; to: Status; action: Action; emailDecision: AdCreativeDecision | null }
> = {
  approve: { from: "pending", to: "approved", action: "approved", emailDecision: "approved" },
  reject: { from: "pending", to: "rejected", action: "rejected", emailDecision: "rejected" },
  request_changes: {
    from: "pending",
    to: "draft",
    action: "changes_requested",
    emailDecision: "changes_requested",
  },
  // Pull an already-approved creative — drops it from the next manifest (AD-P6).
  // The advertiser is told, so a paused ad is never a surprise.
  suspend: { from: "approved", to: "suspended", action: "suspended", emailDecision: "suspended" },
  // Send a suspended creative back for re-review.
  reactivate: { from: "suspended", to: "pending", action: "reactivated", emailDecision: null },
};

const reviewSchema = z
  .object({
    creativeId: z.string().uuid("Unknown ad."),
    decision: z.enum(["approve", "reject", "request_changes", "suspend", "reactivate"]),
    note: z.string().trim().max(2000).optional(),
  })
  // A rejection or change request must tell the advertiser why.
  .refine((v) => (v.decision !== "reject" && v.decision !== "request_changes") || !!v.note, {
    message: "Add a note for the advertiser.",
    path: ["note"],
  });

export async function reviewCreativeAction(
  _prev: ReviewResult | null,
  formData: FormData,
): Promise<ReviewResult> {
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canReviewAds(userId))) {
    return { ok: false, error: "You don't have access to the approvals queue." };
  }

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { creativeId, decision, note } = parsed.data;
  const transition = TRANSITIONS[decision];

  const [creative] = await db
    .select({
      status: adCreatives.status,
      headline: adCreatives.headline,
      body: adCreatives.body,
      altText: adCreatives.altText,
      clickUrl: adCreatives.clickUrl,
      slot: adCreatives.slot,
      avservCreativeRef: adCreatives.avservCreativeRef,
      targetKind: adCreatives.targetKind,
      targetLat: adCreatives.targetLat,
      targetLon: adCreatives.targetLon,
      targetRadiusMi: adCreatives.targetRadiusMi,
      targetAdminLevel: adCreatives.targetAdminLevel,
      targetAdminFips: adCreatives.targetAdminFips,
      advertiserName: advertiserAccounts.name,
      advertiserEmail: advertiserAccounts.contactEmail,
      advertiserId: adCampaigns.advertiserId,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!creative) {
    return { ok: false, error: "That ad no longer exists." };
  }
  if (creative.status !== transition.from) {
    return {
      ok: false,
      error: `Can't ${decision.replace("_", " ")} a creative that's ${creative.status}.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      if (decision === "approve") {
        await tx
          .update(adCreatives)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByUserId: userId,
            reviewNote: null,
          })
          .where(eq(adCreatives.id, creativeId));
      } else if (decision === "reject") {
        await tx
          .update(adCreatives)
          .set({ status: "rejected", reviewNote: note })
          .where(eq(adCreatives.id, creativeId));
      } else if (decision === "request_changes") {
        // Back to draft so the advertiser sees the note and can resubmit.
        await tx
          .update(adCreatives)
          .set({ status: "draft", reviewNote: note, submittedAt: null })
          .where(eq(adCreatives.id, creativeId));
      } else if (decision === "suspend") {
        await tx
          .update(adCreatives)
          .set({ status: "suspended", reviewNote: note ?? null })
          .where(eq(adCreatives.id, creativeId));
      } else {
        // reactivate — clear the prior approval/publish stamps; re-review from pending.
        await tx
          .update(adCreatives)
          .set({ status: "pending", approvedAt: null, approvedByUserId: null, publishedAt: null, reviewNote: null })
          .where(eq(adCreatives.id, creativeId));
      }
      await tx.insert(adCreativeStatusLog).values({
        creativeId,
        action: transition.action,
        fromStatus: creative.status,
        toStatus: transition.to,
        note: note ?? null,
        actorUserId: userId,
      });
    });
  } catch (err) {
    logger.error({ event: "ad.review.tx_failed", userId, creativeId, decision, err });
    return { ok: false, error: "Couldn't record the decision. Try again in a moment." };
  }

  logger.info({ event: "ad.review.success", userId, creativeId, decision });

  // Sync publication with AvServ outside the transaction (an S2S call must never
  // hold a DB tx open, and a publish hiccup must not undo a recorded decision):
  //  - approve  → publish (writes avserv_creative_ref + publishedAt on success)
  //  - suspend  → unpublish (drops it from the next manifest; clears the stamps)
  // reject / request_changes / reactivate move out of a live state without ever
  // having an active ref to pull (reactivate comes from suspended, already pulled).
  let published = false;
  if (decision === "approve") {
    published = await publishAndRecord({
      id: creativeId,
      slot: creative.slot,
      headline: creative.headline,
      body: creative.body,
      altText: creative.altText,
      clickUrl: creative.clickUrl,
      targetKind: creative.targetKind,
      targetLat: creative.targetLat,
      targetLon: creative.targetLon,
      targetRadiusMi: creative.targetRadiusMi,
      targetAdminLevel: creative.targetAdminLevel,
      targetAdminFips: creative.targetAdminFips,
    });
  } else if (decision === "suspend") {
    await unpublishAndClear(creativeId, creative.avservCreativeRef);
  }

  // Notify the advertiser of every decision but reactivate, outside the transaction
  // (a mail hiccup must not undo a recorded decision). Failures logged, not fatal.
  if (transition.emailDecision) {
    try {
      await sendAdCreativeDecisionEmail(creative.advertiserEmail, {
        advertiserName: creative.advertiserName,
        headline: creative.headline,
        decision: transition.emailDecision,
        note,
        published,
        creativeUrl: portalUrl(
          `/advertiser/${creative.advertiserId}/creatives/${creativeId}${transition.emailDecision === "changes_requested" ? "/edit" : ""}`,
        ),
      });
    } catch (err) {
      logger.error({ event: "ad.review.email_failed", creativeId, err });
    }
  }

  revalidatePath("/admin/ad-approvals");
  return { ok: true };
}

export type PublishResult = { ok: true } | { ok: false; error: string };

// Retry publishing an already-approved creative that isn't live yet (publish
// failed at approve time). Staff-gated. This is the no-silent-failure recovery
// path for invariant 5 (docs/plans/30 §9): an "approved, not yet live" creative
// always has a way back to live. `creativeId` is bound by the form.
export async function publishApprovedCreativeAction(
  creativeId: string,
  _prev: PublishResult | null,
  _formData: FormData,
): Promise<PublishResult> {
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await canReviewAds(actor.userId))) {
    return { ok: false, error: "You don't have access to the approvals queue." };
  }

  const [creative] = await db
    .select({
      id: adCreatives.id,
      status: adCreatives.status,
      publishedAt: adCreatives.publishedAt,
      slot: adCreatives.slot,
      headline: adCreatives.headline,
      body: adCreatives.body,
      altText: adCreatives.altText,
      clickUrl: adCreatives.clickUrl,
      targetKind: adCreatives.targetKind,
      targetLat: adCreatives.targetLat,
      targetLon: adCreatives.targetLon,
      targetRadiusMi: adCreatives.targetRadiusMi,
      targetAdminLevel: adCreatives.targetAdminLevel,
      targetAdminFips: adCreatives.targetAdminFips,
    })
    .from(adCreatives)
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!creative) {
    return { ok: false, error: "That ad no longer exists." };
  }
  if (creative.status !== "approved") {
    return { ok: false, error: `Only an approved creative can be published (this one is ${creative.status}).` };
  }
  if (creative.publishedAt) {
    return { ok: false, error: "This ad is already live." };
  }

  const published = await publishAndRecord(creative);
  if (!published) {
    return { ok: false, error: "AvServ didn't accept the ad. Try again in a moment." };
  }

  logger.info({ event: "ad.publish.retry_success", userId: actor.userId, creativeId });
  revalidatePath("/admin/ad-approvals");
  return { ok: true };
}
