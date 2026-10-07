"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { orgInvitations, sarOrgs } from "@/lib/db/schema";
import { sendOrgInviteEmail } from "@/lib/email/send";
import { inviteMemberSchema } from "@/lib/sar/invite";
import { generateInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { portalUrl } from "@/lib/email/links";

// Invite a member to a SAR org (rmdig-ai docs/plans/06 §"Member invitation").
// Org-admin gated (re-checked here, never trusting the page), and only for an
// APPROVED org — you can't staff a team that isn't verified yet. Returns the
// invite link so the page can show it for copying; the link is also emailed.
// `orgId` is bound by the form (createInvitationAction.bind(null, orgId)).

// 50 invites/org/day — a ceiling no legitimate team reaches (the largest SAR
// rosters are dozens of members total), so the authenticated email-fan-out
// vector is bounded even when nobody is watching. If a real org ever trips
// it, that's the trigger for tiered limits (operator decision 2026-08-07).
const INVITE_RATE_LIMIT = { limit: 50, windowSec: 24 * 60 * 60 };

export type InviteResult =
  | { ok: true; inviteUrl: string; email: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createInvitationAction(
  orgId: string,
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) {
    return { ok: false, error: "Only an organization admin can invite members." };
  }

  const [org] = await db
    .select({ name: sarOrgs.name, status: sarOrgs.status })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) {
    return { ok: false, error: "That organization no longer exists." };
  }
  // Pending orgs CAN invite (operator decision 2026-07-26): membership grants
  // nothing until approval — alert routing is gated exclusively on the org
  // reaching `approved` (§0) — and letting a team assemble during review is
  // the point of self-serve onboarding. Rejected/suspended orgs stay blocked.
  if (org.status !== "approved" && org.status !== "pending") {
    return {
      ok: false,
      error: "Your organization can't invite members while it is " + org.status + ".",
    };
  }

  const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email, role } = parsed.data;

  const rate = await incrementRateLimit(`invite-org:${orgId}`, INVITE_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "sar.invite.rate_limited", orgId, userId, attempts: rate.attempts });
    return {
      ok: false,
      error: "This organization reached its daily invite limit. Try again tomorrow.",
    };
  }

  const { token, tokenHash, expires } = generateInviteToken();

  // One live invitation per (org, email): drop any prior un-accepted one so a
  // re-invite supersedes it rather than leaving two valid links.
  await db
    .delete(orgInvitations)
    .where(
      and(
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.email, email),
        isNull(orgInvitations.acceptedAt),
      ),
    );
  await db.insert(orgInvitations).values({
    orgId,
    email,
    role,
    tokenHash,
    expiresAt: expires,
    createdByUserId: userId,
  });
  const inviteUrl = portalUrl(`/invite/${token}`);

  // Email the invite, but don't fail the action if mail is down — the inviter
  // gets the link back to share directly. Log loudly.
  try {
    await sendOrgInviteEmail(email, { orgName: org.name, inviteUrl, role });
  } catch (err) {
    logger.error({ event: "sar.invite.email_failed", orgId, err });
  }

  logger.info({ event: "sar.invite.created", orgId, userId, role });
  revalidatePath(`/sar/${orgId}/members`);
  return { ok: true, inviteUrl, email };
}
