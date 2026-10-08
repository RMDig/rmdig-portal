"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { getOrgRole } from "@/lib/auth/org-roles";
import { isSarApprover } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgStatusLog, users } from "@/lib/db/schema";
import { type SarOrgDecision } from "@/lib/email/templates/SarOrgDecisionEmail";
import { portalUrl } from "@/lib/email/links";
import { sendSarOrgDecisionEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";
import { avservNodes, getSarTeam } from "@/lib/avserv/sar-teams";
import { syncSarOrg } from "@/lib/sar/sync";

// Operator decisions on a SAR org (rmdig-ai docs/plans/06 — the status state
// machine). Gated to rmdig_sar_approver (lib/auth/roles.ts), re-checked here. Each decision is valid
// only from a specific current status; it flips status, appends to the
// append-only sar_org_status_log, and (for the three review decisions) emails
// the submitter. suspend/reactivate are operator-lifecycle actions on an
// already-approved org and don't email (rare, communicated out of band).
//
// A decision applies only to what the reviewer saw (CLAUDE.md §0): the form
// carries the org's review_revision, and the UPDATE matches both that and the
// from-status, bumping the revision. An application edited, or decided by
// someone else, since the page loaded changes nothing and says so. Nobody
// approves or re-verifies an organization they submitted or are a member of.

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
    // The review_revision the page showed (a hidden field on every form).
    revision: z.coerce.number().int().min(0),
    decision: z.enum(["approve", "reject", "request_changes", "suspend", "reactivate", "mark_leaving", "withdraw", "reverify"]),
    // An empty textarea is no note, not an empty one in the log.
    note: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  })
  // A rejection or change request must tell the submitter why. Approving or
  // re-verifying a ski patrol needs a note too (checked once the org type is
  // known); otherwise the note is optional and only goes in the status log.
  .refine((v) => (v.decision !== "reject" && v.decision !== "request_changes") || !!v.note, {
    message: "Add a note for the submitter.",
    path: ["note"],
  });

export async function reviewSarOrgAction(
  _prev: ReviewResult | null,
  formData: FormData,
): Promise<ReviewResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await isSarApprover(userId))) {
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
  const { orgId, decision, note, revision } = parsed.data;
  const transition = TRANSITIONS[decision];

  const [org] = await db
    .select({
      status: sarOrgs.status,
      name: sarOrgs.name,
      orgType: sarOrgs.orgType,
      submitterEmail: users.email,
      createdByUserId: sarOrgs.createdByUserId,
      reviewRevision: sarOrgs.reviewRevision,
    })
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
  if (org.reviewRevision !== revision) {
    return { ok: false, error: STALE_ERROR };
  }
  // Verification is someone else's call: nobody vouches for an org they
  // submitted or belong to (any role).
  if (decision === "approve" || decision === "reverify") {
    const conflict =
      org.createdByUserId === userId
        ? "You submitted this organization, so another approver has to review it."
        : (await getOrgRole(userId, orgId))
          ? "You're a member of this organization, so another approver has to review it."
          : null;
    if (conflict) {
      logger.warn({ event: "sar.review.conflict_refused", userId, orgId, decision });
      return { ok: false, error: conflict };
    }
  }
  if (decision === "reverify" && org.orgType !== "ski_patrol") {
    return { ok: false, error: "Only ski patrols are re-verified." };
  }
  // A patrol is verified by calling the ski area (runbook "SAR org approval"
  // step 4); the note in the status log is the record of that call.
  if ((decision === "approve" || decision === "reverify") && org.orgType === "ski_patrol" && !note) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { note: ["Note the call to the ski area: who you spoke to and the number you used."] },
    };
  }
  if (decision === "withdraw") {
    const blocked = await openBindingsBlocker(orgId);
    if (blocked) return { ok: false, error: blocked };
  }
  const now = new Date();

  const changes = decisionChanges(decision, { now, userId, note, patrol: org.orgType === "ski_patrol" });

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(sarOrgs)
        .set({ ...changes, reviewRevision: sql`${sarOrgs.reviewRevision} + 1` })
        .where(and(eq(sarOrgs.id, orgId), eq(sarOrgs.status, org.status), eq(sarOrgs.reviewRevision, revision)))
        .returning({ id: sarOrgs.id });
      if (updated.length === 0) throw new DecisionStale();
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
    if (err instanceof DecisionStale) {
      logger.warn({ event: "sar.review.stale", userId, orgId, decision, revision });
      return { ok: false, error: STALE_ERROR };
    }
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
        // An approval note is staff-only (it records the verification call).
        note: decision === "approve" ? undefined : note,
        actionUrl:
          transition.emailDecision === "approved"
            ? portalUrl(`/sar/${orgId}/members`)
            : transition.emailDecision === "changes_requested"
              ? portalUrl(`/sar/${orgId}/edit`)
              : undefined,
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
      reportError("sar.sync.failed", err, { orgId, decision });
    }
  }

  revalidatePath("/admin/sar-approvals");
  return { ok: true };
}

/** What a decision writes to the org row, besides bumping review_revision.
 *  request_changes and reverify leave the status as it is. */
function decisionChanges(
  decision: Decision,
  c: { now: Date; userId: string; note: string | undefined; patrol: boolean },
): Partial<typeof sarOrgs.$inferInsert> {
  switch (decision) {
    case "approve":
      return {
        status: "approved",
        approvedAt: c.now,
        approvedByUserId: c.userId,
        reviewNote: null,
        // Patrols are verified at approval and every 12 months after.
        verifiedAt: c.patrol ? c.now : null,
        reverifyBy: c.patrol ? plusMonths(c.now, PATROL_REVERIFY_MONTHS) : null,
      };
    case "mark_leaving":
      return { status: "leaving", leavingNoticeAt: c.now };
    case "withdraw":
      return { status: "withdrawn" };
    case "reverify":
      return { verifiedAt: c.now, reverifyBy: plusMonths(c.now, PATROL_REVERIFY_MONTHS) };
    case "reactivate":
      // Back to pending for re-review; clear the prior approval stamp.
      return { status: "pending", approvedAt: null, approvedByUserId: null, reviewNote: null };
    case "reject":
      return { status: "rejected", reviewNote: c.note };
    case "suspend":
      return { status: "suspended", reviewNote: c.note ?? null };
    case "request_changes":
      // Status stays pending; the note carries the ask.
      return { reviewNote: c.note };
  }
}

class DecisionStale extends Error {}
const STALE_ERROR =
  "This organization changed after you opened the page (an edit, or another reviewer's decision). Reload and review it again.";

/** A reason withdrawal must wait, or null only when every node reports 0
 *  open bindings (sar_team_sync.md §2.5). A leaving team keeps receiving
 *  alerts for check-outs already bound to it, so withdrawing early would stop
 *  them: anything short of a 0 from every node blocks, including a node that
 *  doesn't answer, one that hasn't received the team, and no nodes at all. */
async function openBindingsBlocker(orgId: string): Promise<string | null> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "sar.withdraw.no_avserv_nodes", orgId });
    return "No AvAI servers are configured, so open check-outs can't be confirmed.";
  }
  for (const node of nodes) {
    let view: Awaited<ReturnType<typeof getSarTeam>>;
    try {
      view = await getSarTeam(node, orgId);
    } catch (err) {
      logger.error({ event: "sar.withdraw.node_check_failed", orgId, node: node.name, err });
      return `Couldn't confirm open check-outs with ${node.name}. Try again in a moment.`;
    }
    if (!view) {
      logger.error({ event: "sar.withdraw.node_missing_team", orgId, node: node.name });
      return `${node.name} hasn't received this team, so it can't confirm open check-outs. Press Resync to AvServ, then try again.`;
    }
    if (view.openBindings > 0) {
      return `${node.name} still has ${view.openBindings} check-out${view.openBindings === 1 ? "" : "s"} bound to this team. Withdraw once they end.`;
    }
  }
  return null;
}

/** Staff resend the current state to every node (after a failed node). */
export async function resyncSarOrgAction(formData: FormData): Promise<void> {
  const actor = await portalActor();
  if (!actor.ok) throw new Error(actor.error);
  const userId = actor.userId;
  if (!(await isSarApprover(userId))) throw new Error("You don't have access to the approvals queue.");
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  await syncSarOrg(orgId);
  logger.info({ event: "sar.sync.resync", userId, orgId });
  revalidatePath("/admin/sar-approvals");
}
