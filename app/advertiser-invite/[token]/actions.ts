"use server";

import { and, eq, gt, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { advertiserInvitations, advertiserMemberships } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";

// Accept an advertiser-team invitation (docs/plans/30 §3). The token is the bearer
// credential — the signed-in user joins the advertiser with the invited role. Lives
// at top-level /advertiser-invite (not under (portal)) so a signed-out invitee isn't
// bounced to /sign-in before we can show them the invitation. `token` is bound by
// the form (acceptAdvertiserInvitationAction.bind(null, token)).

export type AcceptResult =
  | { ok: true; advertiserId: string }
  | { ok: false; error: string };

export async function acceptAdvertiserInvitationAction(
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
      id: advertiserInvitations.id,
      advertiserId: advertiserInvitations.advertiserId,
      role: advertiserInvitations.role,
      createdByUserId: advertiserInvitations.createdByUserId,
    })
    .from(advertiserInvitations)
    .where(
      and(
        eq(advertiserInvitations.tokenHash, tokenHash),
        isNull(advertiserInvitations.acceptedAt),
        gt(advertiserInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) {
    return { ok: false, error: "This invitation is invalid, already used, or has expired." };
  }

  try {
    await db.transaction(async (tx) => {
      // onConflictDoNothing: if the user is already a member (e.g. a re-used link),
      // keep their existing role rather than overwriting it.
      await tx
        .insert(advertiserMemberships)
        .values({
          advertiserId: invite.advertiserId,
          userId,
          role: invite.role,
          invitedByUserId: invite.createdByUserId,
        })
        .onConflictDoNothing();
      await tx
        .update(advertiserInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(advertiserInvitations.id, invite.id));
    });
  } catch (err) {
    logger.error({
      event: "advertiser.invite.accept_failed",
      inviteId: invite.id,
      userId,
      err,
    });
    return { ok: false, error: "Couldn't accept the invitation. Try again in a moment." };
  }

  logger.info({
    event: "advertiser.invite.accepted",
    advertiserId: invite.advertiserId,
    userId,
  });
  return { ok: true, advertiserId: invite.advertiserId };
}
