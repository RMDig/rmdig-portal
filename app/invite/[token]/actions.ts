"use server";

import { and, eq, gt, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orgInvitations, orgMembershipLog, orgMemberships } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";

// Accept an org invitation (rmdig-ai docs/plans/06). The token is the bearer
// credential — the signed-in user joins the org with the invited role. Lives at
// top-level /invite (not under (portal)) so a signed-out invitee isn't bounced
// to /sign-in before we can show them the invitation. `token` is bound by the
// form (acceptInvitationAction.bind(null, token)).

export type AcceptResult = { ok: true; orgId: string } | { ok: false; error: string };

export async function acceptInvitationAction(
  token: string,
  _prev: AcceptResult | null,
  _formData: FormData,
): Promise<AcceptResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sign in or create an account, then open this link to accept." };
  }
  const userId = session.user.id;

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

  try {
    await db.transaction(async (tx) => {
      // onConflictDoNothing: if the user is already a member (e.g. a re-used
      // link), keep their existing role rather than overwriting it.
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
      await tx
        .update(orgInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(orgInvitations.id, invite.id));
    });
  } catch (err) {
    logger.error({ event: "sar.invite.accept_failed", inviteId: invite.id, userId, err });
    return { ok: false, error: "Couldn't accept the invitation. Try again in a moment." };
  }

  logger.info({ event: "sar.invite.accepted", orgId: invite.orgId, userId });
  return { ok: true, orgId: invite.orgId };
}
