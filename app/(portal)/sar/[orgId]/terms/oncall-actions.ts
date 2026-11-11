"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { sarOncallEmailVerifications, sarOrgs } from "@/lib/db/schema";
import { portalUrl } from "@/lib/email/links";
import { sendOncallEmailConfirmEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { generateOncallToken, ONCALL_LINK_RATE_LIMIT, ONCALL_LINK_TTL_HOURS, oncallEmailSchema } from "@/lib/sar/oncall-email";

// A team admin proposes the team's on-call address (plan 33 9.10). Nothing
// changes until someone confirms it from that inbox (app/(auth)/oncall-verify):
// the current address, if any, keeps receiving alerts until then.

export type OncallRequestResult = { ok: true; address: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function requestOncallEmailAction(orgId: string, _prev: OncallRequestResult | null, formData: FormData): Promise<OncallRequestResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) return { ok: false, error: "Only your team's admins can set its on-call email." };

  const [org] = await db
    .select({ name: sarOrgs.name, status: sarOrgs.status, isDrill: sarOrgs.isDrill, oncallEmail: sarOrgs.oncallEmail })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "That team no longer exists." };
  if (org.status !== "pending" && org.status !== "approved") {
    return { ok: false, error: `The on-call email can't be changed while your team is ${org.status}.` };
  }

  const parsed = oncallEmailSchema.safeParse({ address: formData.get("address") ?? "" });
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const { address } = parsed.data;
  if (address === org.oncallEmail) return { ok: false, error: "That's already your team's on-call email.", fieldErrors: { address: ["Already confirmed."] } };

  if (!(await incrementRateLimit(`oncall-link:${orgId}`, ONCALL_LINK_RATE_LIMIT)).allowed) {
    logger.warn({ event: "sar.oncall.rate_limited", orgId, userId });
    return { ok: false, error: "Your team has sent 5 confirmation links today. Try again tomorrow." };
  }

  const { token, tokenHash, expires } = generateOncallToken();
  try {
    await db.transaction(async (tx) => {
      // One open request per team: a new address replaces the last unconfirmed one.
      await tx.delete(sarOncallEmailVerifications).where(and(eq(sarOncallEmailVerifications.orgId, orgId), isNull(sarOncallEmailVerifications.confirmedAt)));
      await tx.insert(sarOncallEmailVerifications).values({ orgId, address, tokenHash, expires, requestedByUserId: userId });
    });
  } catch (err) {
    logger.error({ event: "sar.oncall.request_failed", orgId, userId, err });
    return { ok: false, error: "Couldn't save the address. Try again in a moment." };
  }

  try {
    await sendOncallEmailConfirmEmail(address, {
      teamName: org.name,
      confirmUrl: portalUrl(`/oncall-verify?token=${token}`),
      expiresInHours: ONCALL_LINK_TTL_HOURS,
      drill: org.isDrill,
    });
  } catch (err) {
    // deliver() has reported it to Sentry. The link is useless unsent, so say so.
    logger.error({ event: "sar.oncall.email_failed", orgId, userId, err });
    revalidatePath(`/sar/${orgId}/terms`);
    return { ok: false, error: "Couldn't send the confirmation email. Check the address and try again." };
  }
  logger.info({ event: "sar.oncall.requested", orgId, userId });
  revalidatePath(`/sar/${orgId}/terms`);
  return { ok: true, address };
}
