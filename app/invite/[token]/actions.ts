"use server";

import { and, eq, gt, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orgInvitations, orgMembershipLog, orgMemberships } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";

// Accept an org invitation (rmdig-ai docs/plans/06). The token alone isn't
// enough: like staff invites (app/admin-invite), the signed-in account's email
// must be the invited one, so a forwarded or leaked link can't put whoever opens
// it on a SAR team (and so in front of safety-of-life alert routing). Session
// emails are verified: credentials sign-in requires it and OAuth sign-in
// verifies (lib/auth). Lives at top-level /invite (not under (portal)) so a
// signed-out invitee isn't bounced to /sign-in before we can show them the
// invitation. `token` is bound by the form (acceptInvitationAction.bind(null, token)).

export type AcceptResult = { ok: true; orgId: string } | { ok: false; error: string };

// Thrown inside the transaction to roll it back when the guarded claim loses.
class InvitationAlreadyClaimed extends Error {}

export async function acceptInvitationAction(
  token: string,
  _prev: AcceptResult | null,
  _formData: FormData,
): Promise<AcceptResult> {
  const session = await auth();
  const userId = session?.user?.id;
  const sessionEmail = session?.user?.email?.toLowerCase();
  if (!userId || !sessionEmail) {
    return { ok: false, error: "Sign in or create an account, then open this link to accept." };
  }

  const tokenHash = hashInviteToken(token);
  const [invite] = await db
    .select({
      id: orgInvitations.id,
      orgId: orgInvitations.orgId,
      email: orgInvitations.email,
      role: orgInvitations.role,
      createdByUserId: orgInvitations.createdByUserId,
    })
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.tokenHash, tokenHash),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) {
    return { ok: false, error: "This invitation is invalid, already used, or has expired." };
  }

  if (invite.email !== sessionEmail) {
    logger.warn({ event: "sar.invite.email_mismatch", inviteId: invite.id, userId });
    return {
      ok: false,
      error: `This invitation was issued to ${invite.email}. Sign in with that account to accept it.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Guarded claim first: if another accept raced us (or the link was used
      // between the read above and now), zero rows change and nothing is granted.
      const claimed = await tx
        .update(orgInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(and(eq(orgInvitations.id, invite.id), isNull(orgInvitations.acceptedAt)))
        .returning({ id: orgInvitations.id });
      if (claimed.length === 0) {
        throw new InvitationAlreadyClaimed();
      }
      // onConflictDoNothing: if the user is already a member (e.g. invited
      // again), keep their existing role rather than overwriting it.
      const joined = await tx
        .insert(orgMemberships)
        .values({
          orgId: invite.orgId,
          userId,
          role: invite.role,
          invitedByUserId: invite.createdByUserId,
        })
        .onConflictDoNothing()
        .returning({ userId: orgMemberships.userId });
      // Logged only when this actually added them (docs/plans/33 §4).
      if (joined.length > 0) {
        await tx.insert(orgMembershipLog).values({
          orgId: invite.orgId,
          action: "joined",
          subjectUserId: userId,
          subjectEmail: invite.email,
          toRole: invite.role,
          actorUserId: userId,
        });
      }
    });
  } catch (err) {
    if (err instanceof InvitationAlreadyClaimed) {
      logger.warn({ event: "sar.invite.already_claimed", inviteId: invite.id, userId });
      return { ok: false, error: "This invitation is invalid, already used, or has expired." };
    }
    logger.error({ event: "sar.invite.accept_failed", inviteId: invite.id, userId, err });
    return { ok: false, error: "Couldn't accept the invitation. Try again in a moment." };
  }

  logger.info({ event: "sar.invite.accepted", orgId: invite.orgId, userId });
  return { ok: true, orgId: invite.orgId };
}
