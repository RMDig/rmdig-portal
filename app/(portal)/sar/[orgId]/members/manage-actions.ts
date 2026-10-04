"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { orgInvitations, orgMembershipLog, orgMemberships, users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  changeRoleSchema,
  checkMembershipChange,
  removeMemberSchema,
  revokeInviteSchema,
  type MembershipChange,
} from "@/lib/sar/membership";

// Org admins manage their members (docs/plans/33 §4 portal 7): change a
// member's role, remove a member (or leave), revoke a pending invitation.
// Every change locks the org's membership rows, checks the rules (always at
// least one admin), applies, and writes org_membership_log in one transaction.

export type ManageResult = { ok: true; message: string } | { ok: false; error: string };

class Refused extends Error {}

async function adminOrError(orgId: string): Promise<string | ManageResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) {
    return { ok: false, error: "Only an organization admin can manage members." };
  }
  return userId;
}

async function applyChange(orgId: string, actorId: string, change: MembershipChange): Promise<ManageResult> {
  try {
    const outcome = await db.transaction(async (tx) => {
      // Lock every membership row of the org so concurrent changes serialize.
      const members = await tx
        .select({ userId: orgMemberships.userId, role: orgMemberships.role, email: users.email })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(eq(orgMemberships.orgId, orgId))
        .for("update", { of: orgMemberships });

      const check = checkMembershipChange(members, change, actorId);
      if (!check.ok) throw new Refused(check.error);
      const subjectEmail = members.find((m) => m.userId === change.userId)!.email;

      const where = and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, change.userId));
      if (change.kind === "role") {
        await tx.update(orgMemberships).set({ role: change.toRole }).where(where);
      } else {
        await tx.delete(orgMemberships).where(where);
      }
      await tx.insert(orgMembershipLog).values({
        orgId,
        action: check.action,
        subjectUserId: change.userId,
        subjectEmail,
        fromRole: check.fromRole,
        toRole: change.kind === "role" ? change.toRole : null,
        actorUserId: actorId,
      });
      return { action: check.action, subjectEmail };
    });
    logger.info({ event: `sar.members.${outcome.action}`, orgId, actorId, subjectUserId: change.userId });
    revalidatePath(`/sar/${orgId}/members`);
    const message =
      outcome.action === "role_changed"
        ? `Updated ${outcome.subjectEmail}'s role.`
        : outcome.action === "left"
          ? "You left the organization."
          : `Removed ${outcome.subjectEmail}.`;
    return { ok: true, message };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    logger.error({ event: "sar.members.change_failed", orgId, actorId, kind: change.kind, err });
    return { ok: false, error: "Couldn't save that change. Try again in a moment." };
  }
}

export async function changeMemberRoleAction(
  orgId: string,
  _prev: ManageResult | null,
  formData: FormData,
): Promise<ManageResult> {
  const actor = await adminOrError(orgId);
  if (typeof actor !== "string") return actor;
  const parsed = changeRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Pick a valid role." };
  return applyChange(orgId, actor, { kind: "role", userId: parsed.data.userId, toRole: parsed.data.role });
}

export async function removeMemberAction(
  orgId: string,
  _prev: ManageResult | null,
  formData: FormData,
): Promise<ManageResult> {
  const actor = await adminOrError(orgId);
  if (typeof actor !== "string") return actor;
  const parsed = removeMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Unknown member." };
  return applyChange(orgId, actor, { kind: "remove", userId: parsed.data.userId });
}

export async function revokeInvitationAction(
  orgId: string,
  _prev: ManageResult | null,
  formData: FormData,
): Promise<ManageResult> {
  const actor = await adminOrError(orgId);
  if (typeof actor !== "string") return actor;
  const parsed = revokeInviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Unknown invitation." };

  try {
    const revoked = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(orgInvitations)
        .where(
          and(
            eq(orgInvitations.id, parsed.data.invitationId),
            eq(orgInvitations.orgId, orgId),
            isNull(orgInvitations.acceptedAt),
          ),
        )
        .returning({ email: orgInvitations.email, role: orgInvitations.role });
      const row = rows[0];
      if (!row) return null;
      await tx.insert(orgMembershipLog).values({
        orgId,
        action: "invite_revoked",
        subjectEmail: row.email,
        toRole: row.role,
        actorUserId: actor,
      });
      return row.email;
    });
    if (!revoked) return { ok: false, error: "That invitation was already used or revoked." };
    logger.info({ event: "sar.members.invite_revoked", orgId, actorId: actor });
    revalidatePath(`/sar/${orgId}/members`);
    return { ok: true, message: `Revoked the invitation to ${revoked}.` };
  } catch (err) {
    logger.error({ event: "sar.members.revoke_failed", orgId, actorId: actor, err });
    return { ok: false, error: "Couldn't revoke that invitation. Try again in a moment." };
  }
}
