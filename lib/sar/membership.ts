import { z } from "zod";

import { orgRole } from "../db/schema";

// Rules for changing a SAR org's membership (docs/plans/33 §4 portal 7). Pure;
// the members actions apply them inside a transaction that locks the org's
// membership rows, so two admins can't each demote the other at once.

export type OrgRole = (typeof orgRole.enumValues)[number];

export interface Member {
  userId: string;
  role: OrgRole;
}

export type MembershipChange =
  | { kind: "role"; userId: string; toRole: OrgRole }
  | { kind: "remove"; userId: string };

export type ChangeCheck =
  | { ok: true; fromRole: OrgRole; action: "role_changed" | "removed" | "left" }
  | { ok: false; error: string };

/** Whether `actorId` may make `change` to an org with these members. The
 *  caller has already checked the actor is an admin of the org. */
export function checkMembershipChange(members: Member[], change: MembershipChange, actorId: string): ChangeCheck {
  const subject = members.find((m) => m.userId === change.userId);
  if (!subject) return { ok: false, error: "That person isn't a member of this organization." };

  if (change.kind === "role" && change.toRole === subject.role) {
    return { ok: false, error: "They already have that role." };
  }

  const after =
    change.kind === "remove"
      ? members.filter((m) => m.userId !== change.userId)
      : members.map((m) => (m.userId === change.userId ? { ...m, role: change.toRole } : m));
  if (!after.some((m) => m.role === "admin")) {
    return {
      ok: false,
      error: "An organization needs at least one admin. Make someone else an admin first.",
    };
  }

  const action = change.kind === "role" ? "role_changed" : change.userId === actorId ? "left" : "removed";
  return { ok: true, fromRole: subject.role, action };
}

const uuid = z.string().uuid("Unknown member.");

export const changeRoleSchema = z.object({
  userId: uuid,
  role: z.enum(orgRole.enumValues),
});

export const removeMemberSchema = z.object({ userId: uuid });

export const revokeInviteSchema = z.object({ invitationId: z.string().uuid("Unknown invitation.") });
