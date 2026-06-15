"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgStatusLog, users } from "@/lib/db/schema";
import { type SarOrgDecision } from "@/lib/email/templates/SarOrgDecisionEmail";
import { sendSarOrgDecisionEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";

// Operator decisions on a SAR org (rmdig-ai docs/plans/06 — the status state
// machine). Gated to platform staff, re-checked here. Each decision is valid
// only from a specific current status; it flips status, appends to the
// append-only sar_org_status_log, and (for the three review decisions) emails
// the submitter. suspend/reactivate are operator-lifecycle actions on an
// already-approved org and don't email (rare, communicated out of band).

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type Decision = "approve" | "reject" | "request_changes" | "suspend" | "reactivate";
type Status = "pending" | "approved" | "rejected" | "suspended";
type Action = "approved" | "rejected" | "changes_requested" | "suspended" | "reactivated";

// from-status guard, resulting status, audit action, and whether/what to email.
const TRANSITIONS: Record<
  Decision,
  { from: Status; to: Status; action: Action; emailDecision: SarOrgDecision | null }
> = {
  approve: { from: "pending", to: "approved", action: "approved", emailDecision: "approved" },
  reject: { from: "pending", to: "rejected", action: "rejected", emailDecision: "rejected" },
  request_changes: {
    from: "pending",
    to: "pending",
    action: "changes_requested",
    emailDecision: "changes_requested",
  },
  suspend: { from: "approved", to: "suspended", action: "suspended", emailDecision: null },
  reactivate: { from: "suspended", to: "pending", action: "reactivated", emailDecision: null },
};

const reviewSchema = z
  .object({
    orgId: z.string().uuid("Unknown organization."),
    decision: z.enum(["approve", "reject", "request_changes", "suspend", "reactivate"]),
    note: z.string().trim().max(2000).optional(),
  })
  // A rejection or change request must tell the submitter why; the others don't
  // require a note (suspend's reason is optional, approve/reactivate need none).
  .refine((v) => (v.decision !== "reject" && v.decision !== "request_changes") || !!v.note, {
    message: "Add a note for the submitter.",
    path: ["note"],
  });

export async function reviewSarOrgAction(
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
  const { orgId, decision, note } = parsed.data;
  const transition = TRANSITIONS[decision];

  const [org] = await db
    .select({ status: sarOrgs.status, name: sarOrgs.name, submitterEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) {
    return { ok: false, error: "That organization no longer exists." };
  }
  if (org.status !== transition.from) {
    return {
      ok: false,
      error: `Can't ${decision.replace("_", " ")} an organization that's ${org.status}.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      if (decision === "approve") {
        await tx
          .update(sarOrgs)
          .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId, reviewNote: null })
          .where(eq(sarOrgs.id, orgId));
      } else if (decision === "reactivate") {
        // Back to pending for re-review; clear the prior approval stamp.
        await tx
          .update(sarOrgs)
          .set({ status: "pending", approvedAt: null, approvedByUserId: null, reviewNote: null })
          .where(eq(sarOrgs.id, orgId));
      } else if (decision === "reject") {
        await tx.update(sarOrgs).set({ status: "rejected", reviewNote: note }).where(eq(sarOrgs.id, orgId));
      } else if (decision === "suspend") {
        await tx
          .update(sarOrgs)
          .set({ status: "suspended", reviewNote: note ?? null })
          .where(eq(sarOrgs.id, orgId));
      } else {
        // request_changes — status stays pending, note carries the ask.
        await tx.update(sarOrgs).set({ reviewNote: note }).where(eq(sarOrgs.id, orgId));
      }
      await tx.insert(sarOrgStatusLog).values({
        orgId,
        action: transition.action,
        fromStatus: org.status,
        toStatus: transition.to,
        note: note ?? null,
        actorUserId: userId,
      });
    });
  } catch (err) {
    logger.error({ event: "sar.review.tx_failed", userId, orgId, decision, err });
    return { ok: false, error: "Couldn't record the decision. Try again in a moment." };
  }

  logger.info({ event: "sar.review.success", userId, orgId, decision });

  // Notify the submitter for the three review decisions, outside the transaction
  // (a mail hiccup must not undo a recorded decision). Failures logged, not fatal.
  if (transition.emailDecision) {
    try {
      await sendSarOrgDecisionEmail(org.submitterEmail, {
        orgName: org.name,
        decision: transition.emailDecision,
        note,
      });
    } catch (err) {
      logger.error({ event: "sar.review.email_failed", orgId, err });
    }
  }

  revalidatePath("/admin/sar-approvals");
  return { ok: true };
}
