import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { AdSlotPreview } from "@/components/advertiser/AdSlotPreview";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives } from "@/lib/db/schema";
import { CREATIVE_STATUS_LABEL } from "@/lib/advertiser/creative-status";
import { BUYABLE_SLOTS, SLOT_LABEL, type BuyableSlot } from "@/lib/advertiser/creative-schema";

export const metadata = {
  title: "Creative — rmdig",
};

export default async function CreativeDetailPage({
  params,
}: {
  params: Promise<{ advertiserId: string; creativeId: string }>;
}) {
  const { advertiserId, creativeId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  if (!(await isAdvertiserMember(session.user.id, advertiserId))) {
    redirect("/dashboard");
  }

  // Join through the campaign so the creative is proven to belong to THIS advertiser
  // — a member of advertiser A must not read advertiser B's creative by id.
  const [creative] = await db
    .select({
      id: adCreatives.id,
      headline: adCreatives.headline,
      body: adCreatives.body,
      altText: adCreatives.altText,
      clickUrl: adCreatives.clickUrl,
      slot: adCreatives.slot,
      status: adCreatives.status,
      reviewNote: adCreatives.reviewNote,
      campaignName: adCampaigns.name,
      advertiserId: adCampaigns.advertiserId,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(eq(adCreatives.id, creativeId))
    .limit(1);
  if (!creative || creative.advertiserId !== advertiserId) {
    redirect(`/advertiser/${advertiserId}/creatives`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{creative.headline}</h1>
          <p className="text-muted-foreground mt-1">
            {creative.campaignName} · {SLOT_LABEL[creative.slot as BuyableSlot] ?? creative.slot} ·{" "}
            {CREATIVE_STATUS_LABEL[creative.status] ?? creative.status}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/advertiser/${advertiserId}/creatives`}>Back to creatives</Link>
        </Button>
      </div>

      {creative.status === "rejected" && creative.reviewNote ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          <strong>Reviewer note:</strong> {creative.reviewNote}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Content</h2>
        <dl className="divide-y rounded-md border text-sm">
          <div className="flex gap-4 px-4 py-3">
            <dt className="text-muted-foreground w-32 shrink-0">Headline</dt>
            <dd className="min-w-0 break-words">{creative.headline}</dd>
          </div>
          <div className="flex gap-4 px-4 py-3">
            <dt className="text-muted-foreground w-32 shrink-0">Body</dt>
            <dd className="min-w-0 break-words">{creative.body}</dd>
          </div>
          <div className="flex gap-4 px-4 py-3">
            <dt className="text-muted-foreground w-32 shrink-0">Alt text</dt>
            <dd className="min-w-0 break-words">{creative.altText}</dd>
          </div>
          <div className="flex gap-4 px-4 py-3">
            <dt className="text-muted-foreground w-32 shrink-0">Tap-through</dt>
            <dd className="min-w-0 break-words">
              {creative.clickUrl ? (
                <a
                  href={creative.clickUrl}
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {creative.clickUrl}
                </a>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {(BUYABLE_SLOTS as readonly string[]).includes(creative.slot) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">In-slot preview</h2>
          <AdSlotPreview
            slot={creative.slot as BuyableSlot}
            headline={creative.headline}
            body={creative.body}
            clickUrl={creative.clickUrl}
            altText={creative.altText}
          />
        </section>
      ) : null}
    </div>
  );
}
