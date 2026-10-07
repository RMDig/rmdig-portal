import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import type { InitialTarget } from "@/components/advertiser/TargetPicker";
import { auth } from "@/lib/auth";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { BUYABLE_SLOTS, type BuyableSlot } from "@/lib/advertiser/creative-schema";
import { columnsToAdTarget } from "@/lib/advertiser/target";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives } from "@/lib/db/schema";
import { listStates, lookupAdmin } from "@/lib/geo/lookup";

import { CreativeForm } from "../../new/CreativeForm";

export const metadata = { title: "Edit creative — rmdig" };

// Edit a draft or a creative sent back for changes; anything else goes back
// to its page (updateCreativeAction re-checks).
export default async function EditCreativePage({
  params,
}: {
  params: Promise<{ advertiserId: string; creativeId: string }>;
}) {
  const { advertiserId, creativeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!(await isAdvertiserMember(session.user.id, advertiserId))) redirect("/dashboard");

  const [c] = await db
    .select({
      status: adCreatives.status,
      reviewNote: adCreatives.reviewNote,
      slot: adCreatives.slot,
      headline: adCreatives.headline,
      body: adCreatives.body,
      altText: adCreatives.altText,
      clickUrl: adCreatives.clickUrl,
      targetKind: adCreatives.targetKind,
      targetLat: adCreatives.targetLat,
      targetLon: adCreatives.targetLon,
      targetRadiusMi: adCreatives.targetRadiusMi,
      targetAdminLevel: adCreatives.targetAdminLevel,
      targetAdminFips: adCreatives.targetAdminFips,
      campaignName: adCampaigns.name,
      advertiserId: adCampaigns.advertiserId,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  const detail = `/advertiser/${advertiserId}/creatives/${creativeId}`;
  if (!c || c.advertiserId !== advertiserId) redirect(`/advertiser/${advertiserId}/creatives`);
  if (c.status !== "draft" && c.status !== "rejected") redirect(detail);

  const t = columnsToAdTarget(c);
  const target: InitialTarget =
    t.kind === "admin"
      ? { kind: "admin", level: t.level, units: t.fips.flatMap((f) => lookupAdmin(t.level, f) ?? []) }
      : t;
  const slot = (BUYABLE_SLOTS as readonly string[]).includes(c.slot) ? (c.slot as BuyableSlot) : BUYABLE_SLOTS[0]!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit creative</h1>
        {c.reviewNote ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            <strong>Reviewer note:</strong> {c.reviewNote}
          </p>
        ) : null}
      </div>
      <CreativeForm
        advertiserId={advertiserId}
        states={listStates()}
        creativeId={creativeId}
        initial={{
          campaignName: c.campaignName,
          slot,
          headline: c.headline,
          body: c.body,
          altText: c.altText,
          clickUrl: c.clickUrl,
          target,
        }}
      />
    </div>
  );
}
