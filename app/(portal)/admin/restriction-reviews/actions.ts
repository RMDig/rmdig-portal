"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { liftRestriction, listRestrictions, type Restriction } from "@/lib/avserv/restrictions";
import { AvServContractError } from "@/lib/avserv/request";
import { db } from "@/lib/db";
import { restrictionReviewLog, restrictionReviewRequests, users } from "@/lib/db/schema";
import { sendRestrictionReviewUpheldEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { reviewDecisionSchema, scopeLabel, staffActor } from "@/lib/restrictions/review";

// Staff decisions on a review request (docs/plans/32; AvServ contract
// restrictions.md). AvServ owns the restriction; the portal owns the request
// and its append-only log.
//  - lift:   AvServ first (idempotent, §4), then the portal row + log. AvServ
//            emails the user "restored" (§6); the portal sends nothing.
//  - uphold: portal row + log, then the portal's own email. A failed email is
//            logged loudly and does not undo the decision (the row is the record).
//  - close:  only when the restriction is already lifted (e.g. by the CLI).
// Every decision needs a note, kept in the audit log and never shown to the user.

export type ReviewDecisionResult =
  | { ok: true; emailFailed?: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const STATUS_FOR = { uphold: "upheld", lift: "lifted", close: "closed" } as const;

export async function decideReviewAction(
  _prev: ReviewDecisionResult | null,
  formData: FormData,
): Promise<ReviewDecisionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const staffId = session.user.id;
  if (!(await isPlatformStaff(staffId))) {
    return { ok: false, error: "You don't have access to the review queue." };
  }

  const parsed = reviewDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { requestId, decision, note } = parsed.data;

  const [request] = await db
    .select({
      status: restrictionReviewRequests.status,
      accountId: restrictionReviewRequests.avservAccountId,
      restrictionId: restrictionReviewRequests.restrictionId,
      userEmail: users.email,
    })
    .from(restrictionReviewRequests)
    .innerJoin(users, eq(users.id, restrictionReviewRequests.userId))
    .where(eq(restrictionReviewRequests.id, requestId))
    .limit(1);
  if (!request) {
    return { ok: false, error: "That review request no longer exists." };
  }
  if (request.status !== "open") {
    return { ok: false, error: `This request was already decided (${request.status}).` };
  }

  // The restriction as AvServ holds it now: uphold needs it in force, close
  // needs it already lifted, and the email quotes its user-facing reason.
  let restriction: Restriction | undefined;
  try {
    restriction = (await listRestrictions(request.accountId)).find((r) => r.id === request.restrictionId);
  } catch (err) {
    logger.error({ event: "restriction_review.decide.read_failed", staffId, requestId, err });
    return { ok: false, error: avservMessage(err) };
  }
  const alreadyLifted = !restriction || restriction.state === "lifted";
  if (decision === "uphold" && alreadyLifted) {
    return { ok: false, error: "This restriction is no longer in effect. Close the request instead." };
  }
  if (decision === "close" && !alreadyLifted) {
    return { ok: false, error: "This restriction is still in effect. Uphold or lift it." };
  }

  if (decision === "lift") {
    try {
      await liftRestriction(request.accountId, request.restrictionId, {
        note,
        liftedBy: staffActor(staffId),
      });
    } catch (err) {
      logger.error({ event: "restriction_review.lift_failed", staffId, requestId, err });
      return { ok: false, error: avservMessage(err) };
    }
  }

  try {
    const recorded = await db.transaction(async (tx) => {
      const updated = await tx
        .update(restrictionReviewRequests)
        .set({
          status: STATUS_FOR[decision],
          decidedAt: new Date(),
          decidedByUserId: staffId,
          decisionNote: note,
        })
        .where(
          and(eq(restrictionReviewRequests.id, requestId), eq(restrictionReviewRequests.status, "open")),
        )
        .returning({ id: restrictionReviewRequests.id });
      if (updated.length === 0) return false;
      await tx
        .insert(restrictionReviewLog)
        .values({ requestId, action: STATUS_FOR[decision], note, actorUserId: staffId });
      return true;
    });
    if (!recorded) {
      return { ok: false, error: "Someone else decided this request a moment ago. Refresh." };
    }
  } catch (err) {
    logger.error({ event: "restriction_review.decide.write_failed", staffId, requestId, decision, err });
    return {
      ok: false,
      error:
        decision === "lift"
          ? "The restriction was lifted in AvAI, but recording it here failed. Lift again: it's safe to repeat."
          : "We couldn't record the decision. Please try again.",
    };
  }

  logger.info({ event: "restriction_review.decided", staffId, requestId, decision });
  revalidatePath("/admin/restriction-reviews");
  revalidatePath(`/admin/restriction-reviews/${requestId}`);
  revalidatePath("/account/review");

  if (decision === "uphold" && restriction) {
    const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
    try {
      await sendRestrictionReviewUpheldEmail(request.userEmail, {
        feature: scopeLabel(restriction.scope),
        userReason: restriction.userReason,
        reviewUrl: `${baseUrl}/account/review?restriction=${restriction.id}`,
      });
    } catch (err) {
      // The decision stands (the row is the record); staff are told so they can
      // reach the user another way.
      logger.error({ event: "restriction_review.uphold_email_failed", staffId, requestId, err });
      return { ok: true, emailFailed: true };
    }
  }
  return { ok: true };
}

// Staff see AvServ's own words: they act on them (contract §5).
function avservMessage(err: unknown): string {
  if (err instanceof AvServContractError) {
    if (err.code === "restriction_not_found") {
      return "AvAI doesn't have this restriction on the account (it may be on another node still). Refresh and try again.";
    }
    if (err.status === undefined || err.status >= 500) {
      return "AvAI couldn't be reached. Try again in a minute; repeating is safe.";
    }
    return `AvAI refused: ${err.code ?? err.status}${err.detail ? ` (${err.detail})` : ""}.`;
  }
  return "Something went wrong reaching AvAI. Try again.";
}
