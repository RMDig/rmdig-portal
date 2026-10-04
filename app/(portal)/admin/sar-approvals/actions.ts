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
import { avservNodes, getSarTeam } from "@/lib/avserv/sar-teams";
import { syncSarOrg } from "@/lib/sar/sync";

// Operator decisions on a SAR org (rmdig-ai docs/plans/06 — the status state
// machine). Gated to platform staff, re-checked here. Each decision is valid
// only from a specific current status; it flips status, appends to the
// append-only sar_org_status_log, and (for the three review decisions) emails
// the submitter. suspend/reactivate are operator-lifecycle actions on an
// already-approved org and don't email (rare, communicated out of band).

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type Decision =
  | "approve"
  | "reject"
  | "request_changes"
  | "suspend"
  | "reactivate"
  | "mark_leaving"
  | "withdraw"
  | "reverify";
type Status = "pending" | "approved" | "rejected" | "suspended" | "leaving" | "withdrawn";
type Action =
  | "approved"
  | "rejected"
  | "changes_requested"
  | "suspended"
  | "reactivated"
  | "leaving"
  | "withdrawn"
  | "reverified";

// from-status guard, resulting status, audit action, whether/what to email,
// and whether AvServ must be told (docs/plans/33; AvServ sar_team_sync.md).
const TRANSITIONS: Record<
  Decision,
  { from: Status[]; to: Status; action: Action; emailDecision: SarOrgDecision | null; sync: boolean }
> = {
  approve: { from: ["pending"], to: "approved", action: "approved", emailDecision: "approved", sync: true },
  reject: { from: ["pending"], to: "rejected", action: "rejected", emailDecision: "rejected", sync: false },
  request_changes: {
    from: ["pending"],
    to: "pending",
    action: "changes_requested",
    emailDecision: "changes_requested",
    sync: false,
  },
  // Suspension for cause is immediate in AvServ: no dispatch, even to bound check-outs.
  suspend: { from: ["approved", "leaving"], to: "suspended", action: "suspended", emailDecision: null, sync: true },
  // Back to review; AvServ keeps it suspended until it's approved again.
  reactivate: { from: ["suspended"], to: "pending", action: "reactivated", emailDecision: null, sync: false },
  // No new offers or binds; bound check-outs keep the team until they end.
  mark_leaving: { from: ["approved"], to: "leaving", action: "leaving", emailDecision: null, sync: true },
  // Only once no node has open bindings (checked below).
  withdraw: { from: ["leaving", "suspended"], to: "withdrawn", action: "withdrawn", emailDecision: null, sync: true },
  // Ski patrols, yearly (AvServ plan 41 §2.4).
  reverify: { from: ["approved"], to: "approved", action: "reverified", emailDecision: null, sync: true },
};

const PATROL_REVERIFY_MONTHS = 12;
function plusMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

const reviewSchema = z
  .object({
    orgId: z.string().uuid("Unknown organization."),
    decision: z.enum(["approve", "reject", "request_changes", "suspend", "reactivate", "mark_leaving", "withdraw", "reverify"]),
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
    .select({ status: sarOrgs.status, name: sarOrgs.name, orgType: sarOrgs.orgType, submitterEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) {
    return { ok: false, error: "That organization no longer exists." };
  }
  if (!transition.from.includes(org.status)) {
    return {
      ok: false,
      error: `Can't ${decision.replace("_", " ")} an organization that's ${org.status}.`,
    };
  }
  if (decision === "reverify" && org.orgType !== "ski_patrol") {
    return { ok: false, error: "Only ski patrols are re-verified." };
  }
  if (decision === "withdraw") {
    const blocked = await openBindingsBlocker(orgId);
    if (blocked) return { ok: false, error: blocked };
  }
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      if (decision === "approve") {
        // Patrols are verified at approval and every 12 months after.
        const patrol = org.orgType === "ski_patrol";
        await tx
          .update(sarOrgs)
          .set({
            status: "approved",
            approvedAt: now,
            approvedByUserId: userId,
            reviewNote: null,
            verifiedAt: patrol ? now : null,
            reverifyBy: patrol ? plusMonths(now, PATROL_REVERIFY_MONTHS) : null,
          })
          .where(eq(sarOrgs.id, orgId));
      } else if (decision === "mark_leaving") {
        await tx.update(sarOrgs).set({ status: "leaving", leavingNoticeAt: now }).where(eq(sarOrgs.id, orgId));
      } else if (decision === "withdraw") {
        await tx.update(sarOrgs).set({ status: "withdrawn" }).where(eq(sarOrgs.id, orgId));
      } else if (decision === "reverify") {
        await tx
          .update(sarOrgs)
          .set({ verifiedAt: now, reverifyBy: plusMonths(now, PATROL_REVERIFY_MONTHS) })
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

  // Tell AvServ after the decision is recorded. syncSarOrg never throws for a
  // node's answer; an unexpected error here is logged and shown, not undone.
  if (transition.sync) {
    try {
      await syncSarOrg(orgId);
    } catch (err) {
      logger.error({ event: "sar.sync.failed", orgId, decision, err });
    }
  }

  revalidatePath("/admin/sar-approvals");
  return { ok: true };
}

/** A reason withdrawal must wait, or null when every node reports no open
 *  bindings (sar_team_sync.md §1: withdraw a leaving team only at 0 on every
 *  node). A node that has never received the team has none. */
async function openBindingsBlocker(orgId: string): Promise<string | null> {
  for (const node of avservNodes()) {
    try {
      const view = await getSarTeam(node, orgId);
      if (view && view.openBindings > 0) {
        return `${node.name} still has ${view.openBindings} check-out${view.openBindings === 1 ? "" : "s"} bound to this team. Withdraw once they end.`;
      }
    } catch (err) {
      logger.error({ event: "sar.withdraw.node_check_failed", orgId, node: node.name, err });
      return `Couldn't confirm open check-outs with ${node.name}. Try again in a moment.`;
    }
  }
  return null;
}

/** Staff resend the current state to every node (after a failed node). */
export async function resyncSarOrgAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !(await isPlatformStaff(userId))) throw new Error("You don't have access to the approvals queue.");
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  await syncSarOrg(orgId);
  logger.info({ event: "sar.sync.resync", userId, orgId });
  revalidatePath("/admin/sar-approvals");
}
