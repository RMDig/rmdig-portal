"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateResetToken } from "@/lib/auth/reset-tokens";
import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole, isSarApprover } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { orgMembershipLog, orgMemberships, passwordResetTokens, sarOrgs, sarOrgStatusLog, users } from "@/lib/db/schema";
import { portalUrl } from "@/lib/email/links";
import { sendPasswordResetEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";
import { DRILL_ACTIVATED_NOTE, drillLoginSchema } from "@/lib/sar/drill";
import { syncSarOrg } from "@/lib/sar/sync";

// Create a drill login (plan 37 §4.2), for rmdig_admin only: a new account
// marked drill, a member of one drill team, emailed a link to set its
// password. Not an invitation: accepting one adds an account that already
// exists, and an account's drill flag can only be set when it's created
// (migration 0036). So an address that already has an account is refused, and
// a real account is never turned into a drill one.
//
// The link is the ordinary password-reset link (60 minutes). Using it sets
// the password and verifies the address; after that, "Forgot password" on the
// address issues a new one. Two-factor is enrolled at first sign-in, as for
// anyone (MFA_ENFORCEMENT=all).

export type DrillLoginResult =
  | { ok: true; email: string; emailed: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const IN_USE = "An account already uses this address. Choose another drill address.";

// Thrown inside the transaction to roll it back with a known reason.
class DrillLoginRefused extends Error {}

export async function createDrillLoginAction(orgId: string, _prev: DrillLoginResult | null, formData: FormData): Promise<DrillLoginResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const adminId = actor.userId;
  if (!(await hasPlatformRole(adminId, "rmdig_admin"))) {
    logger.warn({ event: "sar.drill.login_forbidden", userId: adminId, orgId });
    return { ok: false, error: "Only rmdig admins can create drill logins." };
  }

  const parsed = drillLoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { email, role } = parsed.data;

  const [org] = await db.select({ isDrill: sarOrgs.isDrill, status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org?.isDrill) return { ok: false, error: "That drill team couldn't be found." };
  if (org.status === "rejected" || org.status === "withdrawn") {
    return { ok: false, error: `This drill team is ${org.status}, so it takes no new logins.` };
  }

  const { token, tokenHash, expires } = generateResetToken();
  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new DrillLoginRefused(IN_USE);
      const [user] = await tx.insert(users).values({ email, isDrill: true }).returning({ id: users.id });
      if (!user) throw new Error("users insert returned no row");
      await tx.insert(orgMemberships).values({ orgId, userId: user.id, role, invitedByUserId: adminId });
      await tx.insert(orgMembershipLog).values({ orgId, action: "joined", subjectUserId: user.id, subjectEmail: email, toRole: role, actorUserId: adminId });
      await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expires });
      return user.id;
    });
  } catch (err) {
    if (err instanceof DrillLoginRefused) return { ok: false, error: err.message, fieldErrors: { email: [err.message] } };
    // Another request took the address between the read and the insert.
    if (isUniqueViolation(err)) return { ok: false, error: IN_USE, fieldErrors: { email: [IN_USE] } };
    logger.error({ event: "sar.drill.login_failed", userId: adminId, orgId, err });
    return { ok: false, error: "Couldn't create the drill login. Try again in a moment." };
  }
  logger.info({ event: "sar.drill.login_created", userId: adminId, orgId, drillUserId: userId, role });

  // The login exists either way: the account is the record. A failed email is
  // loud here and said on the page; "Forgot password" on the address sends a
  // new link.
  let emailed = true;
  try {
    await sendPasswordResetEmail(email, portalUrl(`/reset-password?token=${token}`));
  } catch (err) {
    emailed = false;
    logger.error({ event: "sar.drill.login_email_failed", userId: adminId, orgId, drillUserId: userId, err });
  }
  revalidatePath("/admin/sar-drill");
  return { ok: true, email, emailed };
}

// ----- Activate a drill team (plan 37 §4.6, owner decision DR1) -----
//
// The one path past hand approval that CLAUDE.md §0 allows, and only for a row
// the database proves is a drill team (migration 0036). It takes the team from
// pending to approved and sets the approval fields the sync needs, but records
// `drill_activated` with a note saying no independent review took place. The
// operator may activate a drill team they registered: the approval queue's
// conflict check protects an outside party, and a drill team has none. Real
// teams are untouched: this refuses one, and their Approve still refuses the
// submitter and members.

export type ActivateDrillResult = { ok: true } | { ok: false; error: string };

const activateSchema = z.object({
  orgId: z.string().uuid("Unknown drill team."),
  // The review_revision the page showed, as for every staff decision.
  revision: z.coerce.number().int().min(0),
});

class ActivationStale extends Error {}

export async function activateDrillOrgAction(_prev: ActivateDrillResult | null, formData: FormData): Promise<ActivateDrillResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  // Both roles: an admin manages drill teams, an approver is who may put a
  // team in front of alert routing at all.
  const [admin, approver] = await Promise.all([hasPlatformRole(userId, "rmdig_admin"), isSarApprover(userId)]);
  if (!admin || !approver) {
    logger.warn({ event: "sar.drill.activate_forbidden", userId });
    return { ok: false, error: "Activating a drill team takes both the rmdig admin and SAR approver roles." };
  }

  const parsed = activateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "That drill team couldn't be found." };
  const { orgId, revision } = parsed.data;

  const [org] = await db
    .select({ isDrill: sarOrgs.isDrill, status: sarOrgs.status, reviewRevision: sarOrgs.reviewRevision })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "That drill team couldn't be found." };
  if (!org.isDrill) {
    // Never a way to approve a real team (CLAUDE.md §0).
    logger.warn({ event: "sar.drill.activate_real_refused", userId, orgId });
    return { ok: false, error: "Only a drill team can be activated. A real team is approved from the approvals queue." };
  }
  if (org.status !== "pending") return { ok: false, error: `Can't activate a drill team that's ${org.status}.` };
  if (org.reviewRevision !== revision) return { ok: false, error: ACTIVATE_STALE };

  // A team with no admin can't be exercised, and would page the no-admin check.
  const [hasAdmin] = await db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin")))
    .limit(1);
  if (!hasAdmin) return { ok: false, error: "Add a drill login with the admin role before activating." };

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(sarOrgs)
        .set({ status: "approved", approvedAt: now, approvedByUserId: userId, reviewNote: null, reviewRevision: sql`${sarOrgs.reviewRevision} + 1` })
        .where(and(eq(sarOrgs.id, orgId), eq(sarOrgs.isDrill, true), eq(sarOrgs.status, "pending"), eq(sarOrgs.reviewRevision, revision)))
        .returning({ id: sarOrgs.id });
      if (updated.length === 0) throw new ActivationStale();
      await tx.insert(sarOrgStatusLog).values({
        orgId,
        action: "drill_activated",
        fromStatus: "pending",
        toStatus: "approved",
        note: DRILL_ACTIVATED_NOTE,
        actorUserId: userId,
      });
    });
  } catch (err) {
    if (err instanceof ActivationStale) return { ok: false, error: ACTIVATE_STALE };
    logger.error({ event: "sar.drill.activate_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't activate the drill team. Try again in a moment." };
  }
  logger.info({ event: "sar.drill.activated", userId, orgId });

  // Tell AvServ after the decision is recorded. The sync sends drill: true, and
  // holds the team until every node supports it (P3); a node's answer is shown
  // on the page, never undone into the activation.
  try {
    await syncSarOrg(orgId);
  } catch (err) {
    reportError("sar.sync.failed", err, { orgId, decision: "activate_drill" });
  }
  revalidatePath("/admin/sar-drill");
  return { ok: true };
}

const ACTIVATE_STALE = "This drill team changed after you opened the page. Reload and try again.";
