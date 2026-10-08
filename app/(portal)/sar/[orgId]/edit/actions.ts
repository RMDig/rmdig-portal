"use server";

import { and, eq, sql } from "drizzle-orm";

import { portalActor } from "@/lib/auth/portal-actor";
import { canManageOrg } from "@/lib/auth/org-roles";
import { ProofDocError, uploadProofDoc } from "@/lib/blob/upload";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgStatusLog, users } from "@/lib/db/schema";
import { sendSarOrgPendingReviewEmail } from "@/lib/email/send";
import { SAR_APPROVER_ROLE } from "@/lib/auth/roles";
import { staffEmails } from "@/lib/auth/staff-recipients";
import { logger } from "@/lib/logger";
import { reportError, reportProblem } from "@/lib/report-error";
import { setRegionGeom } from "@/lib/sar/geo";
import { updateSarOrgSchema } from "@/lib/sar/schema";
import { portalUrl } from "@/lib/email/links";

// Resubmitting a pending application (docs/plans/33 §4, portal 2). Only the
// org's admins, only while it's pending: an approved org's area or details
// change only through operator review (CLAUDE.md §0), never here. The edit,
// a `resubmitted` log row and clearing the review note land together; staff
// are emailed afterwards (a failed email is logged, not rolled back).

export type UpdateSarOrgResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function updateSarOrgAction(
  orgId: string,
  _prev: UpdateSarOrgResult | null,
  formData: FormData,
): Promise<UpdateSarOrgResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) {
    return { ok: false, error: "Only your organization's admins can edit the application." };
  }

  const [org] = await db
    .select({ status: sarOrgs.status, submitterEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, sarOrgs.createdByUserId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  if (org.status !== "pending") {
    return {
      ok: false,
      error: "Only an application under review can be edited. To change an approved organization, contact support.",
    };
  }

  const parsed = updateSarOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // A new proof document is optional; an empty file input means "keep it".
  const file = formData.get("proofDoc");
  let proofDocUrl: string | undefined;
  if (file instanceof File && file.size > 0) {
    try {
      ({ url: proofDocUrl } = await uploadProofDoc(file));
    } catch (err) {
      if (err instanceof ProofDocError) {
        return { ok: false, error: err.message, fieldErrors: { proofDoc: [err.message] } };
      }
      logger.error({ event: "sar.resubmit.upload_failed", userId, orgId, err });
      return { ok: false, error: "Couldn't upload your document. Try again in a moment." };
    }
  }

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(sarOrgs)
        .set({
          orgType: data.orgType,
          name: data.name,
          description: data.description ?? null,
          regionName: data.regionName ?? null,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          operatingStatus: data.operatingStatus,
          operatingStatusOther: data.operatingStatusOther ?? null,
          reviewNote: null,
          ...(proofDocUrl ? { proofDocUrl } : {}),
          // A reviewer with the old version open can't decide on it any more.
          reviewRevision: sql`${sarOrgs.reviewRevision} + 1`,
        })
        // Re-checked inside the write so a concurrent approval can't be overwritten.
        .where(and(eq(sarOrgs.id, orgId), eq(sarOrgs.status, "pending")))
        .returning({ id: sarOrgs.id });
      if (updated.length === 0) throw new StatusChanged();
      if (data.region) await setRegionGeom(orgId, data.region, tx);
      await tx.insert(sarOrgStatusLog).values({
        orgId,
        action: "resubmitted",
        fromStatus: "pending",
        toStatus: "pending",
        actorUserId: userId,
      });
    });
  } catch (err) {
    if (err instanceof StatusChanged) {
      return { ok: false, error: "This application was decided while you were editing. Reload to see its status." };
    }
    logger.error({ event: "sar.resubmit.tx_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't save your changes. Try again in a moment." };
  }

  logger.info({ event: "sar.resubmit.success", userId, orgId, newRegion: !!data.region, newProof: !!proofDocUrl });
  await notifyStaff(orgId, data.name, org.submitterEmail);
  return { ok: true };
}

class StatusChanged extends Error {}

async function notifyStaff(orgId: string, orgName: string, submitterEmail: string): Promise<void> {
  const reviewUrl = portalUrl(`/admin/sar-approvals#org-${orgId}`);
  // Everyone who can decide SAR orgs: the SAR approvers.
  let staff: string[];
  try {
    staff = await staffEmails([SAR_APPROVER_ROLE]);
  } catch (err) {
    reportError("sar.resubmit.staff_lookup_failed", err, { orgId });
    return;
  }
  if (staff.length === 0) reportProblem("sar.resubmit.no_staff_to_notify", "No rmdig staff to tell about a resubmitted SAR application", { orgId });
  for (const email of staff) {
    try {
      await sendSarOrgPendingReviewEmail(email, { orgName, submitterEmail, reviewUrl });
    } catch (err) {
      logger.error({ event: "sar.resubmit.staff_email_failed", orgId, to: email, err });
    }
  }
}
