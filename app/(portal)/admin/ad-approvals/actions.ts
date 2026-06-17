"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adCreativeStatusLog,
  advertiserAccounts,
} from "@/lib/db/schema";
import { type AdCreativeDecision } from "@/lib/email/templates/AdCreativeDecisionEmail";
import { sendAdCreativeDecisionEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";

// Operator decisions on an ad creative (AD-P5, docs/plans/30 §5/§6). Manual
// approval is non-negotiable for a safety app — only `approved` creatives become
// eligible for the signed manifest (publish wiring lands in AD-P6). Gated to
// platform staff (rmdig_admin or the broadened rmdig_reviewer), re-checked here.
// Each decision is valid only from a specific current status; it flips status,
// appends to the append-only ad_creative_status_log, and (for the three review
// decisions) emails the advertiser's contact.

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
  suspend: { from: "approved", to: "suspended", action: "suspended", emailDecision: null },
  // Send a suspended creative back for re-review.
  reactivate: { from: "suspended", to: "pending", action: "reactivated", emailDecision: null },
};

const reviewSchema = z
  .object({
    creativeId: z.string().uuid("Unknown creative."),
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
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;
  if (!(await isPlatformStaff(userId))) {
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
      advertiserName: advertiserAccounts.name,
      advertiserEmail: advertiserAccounts.contactEmail,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!creative) {
    return { ok: false, error: "That creative no longer exists." };
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

  // Notify the advertiser for the three review decisions, outside the transaction
  // (a mail hiccup must not undo a recorded decision). Failures logged, not fatal.
  if (transition.emailDecision) {
    try {
      await sendAdCreativeDecisionEmail(creative.advertiserEmail, {
        advertiserName: creative.advertiserName,
        headline: creative.headline,
        decision: transition.emailDecision,
        note,
      });
    } catch (err) {
      logger.error({ event: "ad.review.email_failed", creativeId, err });
    }
  }

  revalidatePath("/admin/ad-approvals");
  return { ok: true };
}
