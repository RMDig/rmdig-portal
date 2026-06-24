"use server";

import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, advertiserAccounts } from "@/lib/db/schema";
import { createCreativeSchema } from "@/lib/advertiser/creative-schema";
import { logger } from "@/lib/logger";

// Author a text creative under an advertiser (AD-P3, docs/plans/30 §5). Any team
// member (editor or admin) may author; re-checked here, never trusting the page.
// The creative persists in `draft` — it reaches users only after the operator
// approves it (AD-P5) and it's published (AD-P6). `advertiserId` is bound by the
// form (createCreativeAction.bind(null, advertiserId)).

export type CreateCreativeResult =
  | { ok: true; creativeId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createCreativeAction(
  advertiserId: string,
  _prev: CreateCreativeResult | null,
  formData: FormData,
): Promise<CreateCreativeResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;
  if (!(await isAdvertiserMember(userId, advertiserId))) {
    return { ok: false, error: "You don't have access to this advertiser account." };
  }

  const [advertiser] = await db
    .select({ status: advertiserAccounts.status })
    .from(advertiserAccounts)
    .where(eq(advertiserAccounts.id, advertiserId))
    .limit(1);
  if (!advertiser) {
    return { ok: false, error: "That advertiser account no longer exists." };
  }
  if (advertiser.status !== "active") {
    return { ok: false, error: "This advertiser account is suspended; you can't author creatives." };
  }

  const parsed = createCreativeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Find-or-create the campaign by name under this advertiser, then insert the
  // draft creative — atomically, so a creative never lands without its campaign.
  let creativeId: string;
  try {
    creativeId = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: adCampaigns.id })
        .from(adCampaigns)
        .where(
          and(eq(adCampaigns.advertiserId, advertiserId), eq(adCampaigns.name, data.campaignName)),
        )
        .limit(1);

      let campaignId = existing?.id;
      if (!campaignId) {
        const [created] = await tx
          .insert(adCampaigns)
          .values({ advertiserId, name: data.campaignName })
          .returning({ id: adCampaigns.id });
        if (!created) {
          throw new Error("ad_campaigns insert returned no row");
        }
        campaignId = created.id;
      }

      const [creative] = await tx
        .insert(adCreatives)
        .values({
          campaignId,
          slot: data.slot,
          headline: data.headline,
          body: data.body,
          altText: data.altText,
          clickUrl: data.clickUrl,
          // status defaults to 'draft'; target_kind defaults to 'national' (app-wide).
          // The targeting fields (radius/admin) arrive with the AD-P7b authoring UI.
        })
        .returning({ id: adCreatives.id });
      if (!creative) {
        throw new Error("ad_creatives insert returned no row");
      }
      return creative.id;
    });
  } catch (err) {
    logger.error({ event: "advertiser.creative.create_failed", userId, advertiserId, err });
    return { ok: false, error: "Couldn't save the creative. Try again in a moment." };
  }

  logger.info({ event: "advertiser.creative.created", userId, advertiserId, creativeId });
  return { ok: true, creativeId };
}
