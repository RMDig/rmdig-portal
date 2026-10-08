"use server";

import { and, eq } from "drizzle-orm";

import { FEATURE_OFF_ERROR, featureEnabled } from "@/lib/features";
import { portalActor } from "@/lib/auth/portal-actor";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, advertiserAccounts } from "@/lib/db/schema";
import { parseCreativeForm } from "@/lib/advertiser/creative-form";
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
  if (!featureEnabled("advertiser_portal")) return { ok: false, error: FEATURE_OFF_ERROR };
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
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
    return { ok: false, error: "This advertiser account is suspended; you can't create ads." };
  }

  const form = parseCreativeForm(formData);
  if (!form.ok) return form;
  const { data, targetColumns } = form;

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
          // status defaults to 'draft'. Targeting columns come from the picker (doc 31
          // §3); national leaves the radius/admin columns null, satisfying the CHECK.
          ...targetColumns,
        })
        .returning({ id: adCreatives.id });
      if (!creative) {
        throw new Error("ad_creatives insert returned no row");
      }
      return creative.id;
    });
  } catch (err) {
    logger.error({ event: "advertiser.creative.create_failed", userId, advertiserId, err });
    return { ok: false, error: "Couldn't save the ad. Try again in a moment." };
  }

  logger.info({ event: "advertiser.creative.created", userId, advertiserId, creativeId });
  return { ok: true, creativeId };
}
