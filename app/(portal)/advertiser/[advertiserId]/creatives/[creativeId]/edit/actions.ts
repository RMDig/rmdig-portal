"use server";

import { and, eq } from "drizzle-orm";

import { parseCreativeForm } from "@/lib/advertiser/creative-form";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, advertiserAccounts } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import type { CreateCreativeResult } from "../../new/actions";

// Edit a draft or sent-back creative (the "update and resubmit" the decision
// email asks for). Approved, pending and suspended creatives can't be edited:
// what staff approved must be what ships. Re-checks membership and ownership
// here, never trusting the page.
const EDITABLE = new Set(["draft", "rejected"]);

export async function updateCreativeAction(
  advertiserId: string,
  creativeId: string,
  _prev: CreateCreativeResult | null,
  formData: FormData,
): Promise<CreateCreativeResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await isAdvertiserMember(userId, advertiserId))) {
    return { ok: false, error: "You don't have access to this advertiser account." };
  }
  const [row] = await db
    .select({ status: adCreatives.status, advertiserId: adCampaigns.advertiserId, advertiserStatus: advertiserAccounts.status })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!row || row.advertiserId !== advertiserId) return { ok: false, error: "That ad no longer exists." };
  if (row.advertiserStatus !== "active") return { ok: false, error: "This advertiser account is suspended; you can't edit ads." };
  if (!EDITABLE.has(row.status)) {
    return { ok: false, error: "Only a draft or an ad sent back for changes can be edited." };
  }

  const form = parseCreativeForm(formData);
  if (!form.ok) return form;
  const { data, targetColumns } = form;

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: adCampaigns.id })
        .from(adCampaigns)
        .where(and(eq(adCampaigns.advertiserId, advertiserId), eq(adCampaigns.name, data.campaignName)))
        .limit(1);
      let campaignId = existing?.id;
      if (!campaignId) {
        const [created] = await tx
          .insert(adCampaigns)
          .values({ advertiserId, name: data.campaignName })
          .returning({ id: adCampaigns.id });
        if (!created) throw new Error("ad_campaigns insert returned no row");
        campaignId = created.id;
      }
      await tx
        .update(adCreatives)
        .set({
          campaignId,
          slot: data.slot,
          headline: data.headline,
          body: data.body,
          altText: data.altText,
          clickUrl: data.clickUrl,
          ...targetColumns,
        })
        .where(eq(adCreatives.id, creativeId));
    });
  } catch (err) {
    logger.error({ event: "advertiser.creative.update_failed", userId, advertiserId, creativeId, err });
    return { ok: false, error: "Couldn't save your changes. Try again in a moment." };
  }
  logger.info({ event: "advertiser.creative.updated", userId, advertiserId, creativeId });
  return { ok: true, creativeId };
}
