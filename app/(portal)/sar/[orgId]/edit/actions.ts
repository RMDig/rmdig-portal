"use server";

import { and, eq } from "drizzle-orm";

import { portalActor } from "@/lib/auth/portal-actor";
import { canManageOrg } from "@/lib/auth/org-roles";
import { ProofDocError, uploadProofDoc } from "@/lib/blob/upload";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgStatusLog, userPlatformRoles, users } from "@/lib/db/schema";
import { sendSarOrgPendingReviewEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { setRegionGeom } from "@/lib/sar/geo";
import { updateSarOrgSchema } from "@/lib/sar/schema";

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
  const reviewUrl = `${env.NEXTAUTH_URL ?? "http://localhost:3000"}/admin/sar-approvals`;
  let admins: { email: string }[];
  try {
    admins = await db
      .select({ email: users.email })
      .from(userPlatformRoles)
      .innerJoin(users, eq(users.id, userPlatformRoles.userId))
      .where(eq(userPlatformRoles.role, "rmdig_admin"));
  } catch (err) {
    logger.error({ event: "sar.resubmit.admin_lookup_failed", orgId, err });
    return;
  }
  for (const admin of admins) {
    try {
      await sendSarOrgPendingReviewEmail(admin.email, { orgName, submitterEmail, reviewUrl });
    } catch (err) {
      logger.error({ event: "sar.resubmit.admin_email_failed", orgId, to: admin.email, err });
    }
  }
}
