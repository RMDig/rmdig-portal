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

// Operator decision on a pending SAR org (rmdig-ai docs/plans/06 §"Operator
// review queue"). Gated to platform staff — re-checked here, never trusting the
// /admin layout to gate a write. Each decision flips status, appends to the
// append-only sar_org_status_log, and emails the submitter. Only `pending` orgs
// can be acted on (suspend/reactivate of approved orgs is a later milestone).

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const reviewSchema = z
  .object({
    orgId: z.string().uuid("Unknown organization."),
    decision: z.enum(["approve", "reject", "request_changes"]),
    note: z.string().trim().max(2000).optional(),
  })
  // A rejection or change request must tell the submitter why; approval needs no note.
  .refine((v) => v.decision === "approve" || !!v.note, {
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

  const [org] = await db
    .select({ status: sarOrgs.status, name: sarOrgs.name, submitterEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) {
    return { ok: false, error: "That organization no longer exists." };
  }
  if (org.status !== "pending") {
    return { ok: false, error: `This application is already ${org.status}.` };
  }

  // Map the operator decision to a status + an audit action. `changes_requested`
  // leaves the org pending (the submitter updates and we review again).
  const emailDecision: SarOrgDecision =
    decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
  const toStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "pending";

  try {
    await db.transaction(async (tx) => {
      if (decision === "approve") {
        await tx
          .update(sarOrgs)
          .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId, reviewNote: null })
          .where(eq(sarOrgs.id, orgId));
      } else if (decision === "reject") {
        await tx.update(sarOrgs).set({ status: "rejected", reviewNote: note }).where(eq(sarOrgs.id, orgId));
      } else {
        await tx.update(sarOrgs).set({ reviewNote: note }).where(eq(sarOrgs.id, orgId));
      }
      await tx.insert(sarOrgStatusLog).values({
        orgId,
        action: emailDecision,
        fromStatus: "pending",
        toStatus,
        note: note ?? null,
        actorUserId: userId,
      });
    });
  } catch (err) {
    logger.error({ event: "sar.review.tx_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't record the decision. Try again in a moment." };
  }

  logger.info({ event: "sar.review.success", userId, orgId, decision });

  // Notify the submitter outside the transaction — a mail hiccup must not undo a
  // recorded decision. Failures are logged, never swallowed.
  try {
    await sendSarOrgDecisionEmail(org.submitterEmail, { orgName: org.name, decision: emailDecision, note });
  } catch (err) {
    logger.error({ event: "sar.review.email_failed", orgId, err });
  }

  // Refresh the queue so the just-decided org drops off the pending list.
  revalidatePath("/admin/sar-approvals");
  return { ok: true };
}
