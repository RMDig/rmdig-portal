"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { FEATURE_OFF_ERROR, featureEnabled } from "@/lib/features";
import { portalActor } from "@/lib/auth/portal-actor";
import { canManageAdvertiser } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import { advertiserAccounts, advertiserInvitations } from "@/lib/db/schema";
import { inviteAdvertiserMemberSchema } from "@/lib/advertiser/schema";
import { sendAdvertiserInviteEmail } from "@/lib/email/send";
import { generateInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";
import { portalUrl } from "@/lib/email/links";

// Invite a member to an advertiser account (docs/plans/30 §3). Advertiser-admin
// gated (re-checked here, never trusting the page). Unlike SAR orgs there is no
// "must be approved first" gate — an advertiser account is active on creation, and
// the safety-critical control is per-creative approval, not team membership. Returns
// the invite link so the page can show it for copying; the link is also emailed.
// `advertiserId` is bound by the form (createAdvertiserInvitationAction.bind).

export type InviteResult =
  | { ok: true; inviteUrl: string; email: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createAdvertiserInvitationAction(
  advertiserId: string,
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageAdvertiser(userId, advertiserId))) {
    return { ok: false, error: "Only an advertiser admin can invite members." };
  }

  const [advertiser] = await db
    .select({ name: advertiserAccounts.name, status: advertiserAccounts.status })
    .from(advertiserAccounts)
    .where(eq(advertiserAccounts.id, advertiserId))
    .limit(1);
  if (!advertiser) {
    return { ok: false, error: "That advertiser account no longer exists." };
  }
  if (advertiser.status !== "active") {
    return { ok: false, error: "This advertiser account is suspended; you can't invite members." };
  }

  const parsed = inviteAdvertiserMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email, role } = parsed.data;

  const { token, tokenHash, expires } = generateInviteToken();

  // One live invitation per (advertiser, email): drop any prior un-accepted one so a
  // re-invite supersedes it rather than leaving two valid links.
  await db
    .delete(advertiserInvitations)
    .where(
      and(
        eq(advertiserInvitations.advertiserId, advertiserId),
        eq(advertiserInvitations.email, email),
        isNull(advertiserInvitations.acceptedAt),
      ),
    );
  await db.insert(advertiserInvitations).values({
    advertiserId,
    email,
    role,
    tokenHash,
    expiresAt: expires,
    createdByUserId: userId,
  });
  const inviteUrl = portalUrl(`/advertiser-invite/${token}`);

  // Email the invite, but don't fail the action if mail is down — the inviter gets
  // the link back to share directly. Log loudly.
  try {
    await sendAdvertiserInviteEmail(email, { advertiserName: advertiser.name, inviteUrl, role });
  } catch (err) {
    logger.error({ event: "advertiser.invite.email_failed", advertiserId, err });
  }

  logger.info({ event: "advertiser.invite.created", advertiserId, userId, role });
  revalidatePath(`/advertiser/${advertiserId}/members`);
  return { ok: true, inviteUrl, email };
}
