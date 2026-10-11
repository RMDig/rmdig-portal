"use server";

import { and, eq, gt, isNull } from "drizzle-orm";

import { FEATURE_OFF_ERROR, featureEnabled } from "@/lib/features";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { advertiserInvitations, advertiserMemberships } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";

// Accept an advertiser-team invitation (docs/plans/30 §3). The token alone isn't
// enough: as with SAR and staff invites (app/invite, app/admin-invite), the
// signed-in account's email must be the invited one, so a forwarded or leaked
// link can't make whoever opens it a member, possibly an admin. Session emails
// are verified: credentials sign-in requires it and OAuth sign-in verifies
// (lib/auth). Lives at top-level /advertiser-invite (not under (portal)) so a
// signed-out invitee isn't bounced to /sign-in before we can show them the
// invitation. `token` is bound by the form
// (acceptAdvertiserInvitationAction.bind(null, token)).

export type AcceptResult =
  | { ok: true; advertiserId: string }
  | { ok: false; error: string };

// Thrown inside the transaction to roll it back when the guarded claim loses.
class InvitationAlreadyClaimed extends Error {}

export async function acceptAdvertiserInvitationAction(
  token: string,
  _prev: AcceptResult | null,
  _formData: FormData,
): Promise<AcceptResult> {
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const session = await auth();
  const userId = session?.user?.id;
  const sessionEmail = session?.user?.email?.toLowerCase();
  if (!userId || !sessionEmail) {
    return { ok: false, error: "Sign in or create an account, then open this link to accept." };
  }

  const tokenHash = hashInviteToken(token);
  const [invite] = await db
    .select({
      id: advertiserInvitations.id,
      advertiserId: advertiserInvitations.advertiserId,
      email: advertiserInvitations.email,
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

  if (invite.email !== sessionEmail) {
    logger.warn({ event: "advertiser.invite.email_mismatch", inviteId: invite.id, userId });
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
        .update(advertiserInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(and(eq(advertiserInvitations.id, invite.id), isNull(advertiserInvitations.acceptedAt)))
        .returning({ id: advertiserInvitations.id });
      if (claimed.length === 0) {
        throw new InvitationAlreadyClaimed();
      }
      // onConflictDoNothing: if the user is already a member (e.g. invited
      // again), keep their existing role rather than overwriting it.
      await tx
        .insert(advertiserMemberships)
        .values({
          advertiserId: invite.advertiserId,
          userId,
          role: invite.role,
          invitedByUserId: invite.createdByUserId,
        })
        .onConflictDoNothing();
    });
  } catch (err) {
    if (err instanceof InvitationAlreadyClaimed) {
      logger.warn({ event: "advertiser.invite.already_claimed", inviteId: invite.id, userId });
      return { ok: false, error: "This invitation is invalid, already used, or has expired." };
    }
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
