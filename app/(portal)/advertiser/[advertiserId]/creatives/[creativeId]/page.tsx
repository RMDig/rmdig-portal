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
import { SubmitCreativeButton } from "./SubmitCreativeButton";

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

      {(creative.status === "rejected" || creative.status === "draft") && creative.reviewNote ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Reviewer note:</strong> {creative.reviewNote}
        </div>
      ) : null}

      {creative.status === "draft" || creative.status === "rejected" ? (
        <div className="space-y-2 rounded-md border p-4">
          <p className="text-sm">
            This creative is a {CREATIVE_STATUS_LABEL[creative.status]?.toLowerCase()}. Submit it for
            review — the operator approves every creative before it appears in the app.
          </p>
          <SubmitCreativeButton
            advertiserId={advertiserId}
            creativeId={creative.id}
            label={creative.status === "rejected" ? "Resubmit for review" : "Submit for review"}
          />
        </div>
      ) : creative.status === "pending" ? (
        <p className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
          Under review. We&apos;ll email you when the operator makes a decision.
        </p>
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
