"use server";

import { and, eq, gt, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformRoleInvitations, platformRoleLog, userPlatformRoles } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";

export type AcceptResult = { ok: true } | { ok: false; error: string } | null;

// Accept a staff invitation. Stricter than org-invite acceptance ON PURPOSE:
// the session email must match the invited email, so a forwarded link can't
// hand platform privileges to whoever opens it. `token` is bound by the form
// (acceptPlatformInviteAction.bind(null, token)).
export async function acceptPlatformInviteAction(
  token: string,
  _prev: AcceptResult,
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
      id: platformRoleInvitations.id,
      email: platformRoleInvitations.email,
      role: platformRoleInvitations.role,
      createdByUserId: platformRoleInvitations.createdByUserId,
    })
    .from(platformRoleInvitations)
    .where(
      and(
        eq(platformRoleInvitations.tokenHash, tokenHash),
        isNull(platformRoleInvitations.acceptedAt),
        gt(platformRoleInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) {
    return { ok: false, error: "This invitation is invalid, already used, or has expired." };
  }

  if (invite.email !== sessionEmail) {
    return {
      ok: false,
      error: `This invitation was issued to ${invite.email}. Sign in with that account to accept it.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Guarded update first: if another accept raced us, zero rows change and
      // we bail before granting twice.
      const claimed = await tx
        .update(platformRoleInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId })
        .where(
          and(eq(platformRoleInvitations.id, invite.id), isNull(platformRoleInvitations.acceptedAt)),
        )
        .returning({ id: platformRoleInvitations.id });
      if (claimed.length === 0) {
        throw new Error("invitation already accepted");
      }
      await tx
        .insert(userPlatformRoles)
        .values({ userId, role: invite.role })
        .onConflictDoNothing();
      await tx.insert(platformRoleLog).values({
        action: "granted",
        role: invite.role,
        targetEmail: invite.email,
        targetUserId: userId,
        // The inviter authorized the grant; acceptance just executes it. The
        // accepter is recorded on the invitation row.
        actorUserId: invite.createdByUserId,
      });
    });
  } catch (err) {
    logger.error({ event: "admin.invite.accept_failed", inviteId: invite.id, userId, err });
    return { ok: false, error: "Couldn't accept the invitation. Try again in a moment." };
  }

  logger.info({ event: "admin.invite.accepted", inviteId: invite.id, userId, role: invite.role });
  return { ok: true };
}
