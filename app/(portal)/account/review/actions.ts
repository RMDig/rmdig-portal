"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { staffEmails } from "@/lib/auth/staff-recipients";
import { listRestrictions } from "@/lib/avserv/restrictions";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { restrictionReviewLog, restrictionReviewRequests, users } from "@/lib/db/schema";
import { sendRestrictionReviewRequestedEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { reviewableRestrictions, reviewRequestSchema } from "@/lib/restrictions/review";
import { portalUrl } from "@/lib/email/links";

// A user asks staff to review a restriction on their AvAI account
// (docs/plans/32; AvServ contract restrictions.md §8). The restriction must be
// in force on the signed-in user's OWN linked account, read through the
// account-scoped GET; the submitted id is only matched against that list,
// never looked up. Idempotent per page render (submissionKey), one open
// request per restriction, rate-limited per AvServ account. CSRF: Server
// Actions reject cross-origin posts (Origin check).

export type ReviewRequestResult =
  | { ok: true; replayed: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

// A handful per day is plenty for a person explaining themselves; it also caps
// how much free text one account can push at the staff queue.
const REVIEW_RATE_LIMIT = { limit: 3, windowSec: 24 * 60 * 60 };

export async function submitReviewRequestAction(
  _prev: ReviewRequestResult | null,
  formData: FormData,
): Promise<ReviewRequestResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const parsed = reviewRequestSchema.safeParse({
    restrictionId: formData.get("restrictionId"),
    submissionKey: formData.get("submissionKey"),
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted field.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { restrictionId, submissionKey, message } = parsed.data;

  // A repeat of the same submit (double click, retry) is the same request.
  const [existing] = await db
    .select({ id: restrictionReviewRequests.id })
    .from(restrictionReviewRequests)
    .where(
      and(
        eq(restrictionReviewRequests.submissionKey, submissionKey),
        eq(restrictionReviewRequests.userId, userId),
      ),
    )
    .limit(1);
  if (existing) return { ok: true, replayed: true };

  const [user] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.avservAccountId) {
    logger.warn({ event: "restriction_review.no_account", userId });
    return {
      ok: false,
      error: "Your account isn't linked to AvAI yet. Sign out and back in, then try again.",
    };
  }
  const accountId = user.avservAccountId;

  const rate = await incrementRateLimit(`restriction-review:acct:${accountId}`, REVIEW_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "restriction_review.rate_limited", userId });
    return { ok: false, error: "You've sent several requests today. Please try again tomorrow." };
  }

  let inForce: boolean;
  try {
    const restrictions = await listRestrictions(accountId);
    inForce = reviewableRestrictions(restrictions).some((r) => r.id === restrictionId);
  } catch (err) {
    logger.error({ event: "restriction_review.read_failed", userId, err });
    return { ok: false, error: "We couldn't reach AvAI to check your account. Please try again shortly." };
  }
  if (!inForce) {
    return {
      ok: false,
      error: "That restriction isn't in effect on this account any more. Refresh the page.",
    };
  }

  let requestId: string;
  try {
    requestId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(restrictionReviewRequests)
        .values({ userId, avservAccountId: accountId, restrictionId, submissionKey, message })
        .returning({ id: restrictionReviewRequests.id });
      if (!row) throw new Error("review request insert returned no row");
      await tx
        .insert(restrictionReviewLog)
        .values({ requestId: row.id, action: "submitted", actorUserId: userId });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Either a concurrent copy of this same submit won (a replay), or the
      // one-open-request rule fired.
      const [same] = await db
        .select({ id: restrictionReviewRequests.id })
        .from(restrictionReviewRequests)
        .where(eq(restrictionReviewRequests.submissionKey, submissionKey))
        .limit(1);
      if (same) return { ok: true, replayed: true };
      return { ok: false, error: "This restriction is already under review. We'll email you." };
    }
    logger.error({ event: "restriction_review.insert_failed", userId, err });
    return { ok: false, error: "We couldn't save your request. Please try again." };
  }

  // The message is the user's free text: never logged.
  logger.info({ event: "restriction_review.submitted", userId, restrictionId, requestId });
  await notifyStaff(requestId);
  revalidatePath("/account/review");
  revalidatePath("/admin/restriction-reviews");
  return { ok: true, replayed: false };
}

// Staff hear about a new request (it used to wait until someone opened the
// queue). The request row is the record: a failed email is logged loudly and
// never fails the user's submit.
async function notifyStaff(requestId: string): Promise<void> {
  const reviewUrl = portalUrl(`/admin/restriction-reviews/${requestId}`);
  let staff: string[];
  try {
    staff = await staffEmails();
  } catch (err) {
    logger.error({ event: "restriction_review.staff_lookup_failed", requestId, err });
    return;
  }
  if (staff.length === 0) logger.error({ event: "restriction_review.no_staff_to_notify", requestId });
  for (const email of staff) {
    try {
      await sendRestrictionReviewRequestedEmail(email, reviewUrl);
    } catch (err) {
      logger.error({ event: "restriction_review.staff_email_failed", requestId, to: email, err });
    }
  }
}
