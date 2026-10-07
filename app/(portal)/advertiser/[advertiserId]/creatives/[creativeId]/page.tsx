import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { AdSlotPreview } from "@/components/advertiser/AdSlotPreview";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives } from "@/lib/db/schema";
import { describeTarget } from "@/lib/geo/lookup";
import { creativeStatusLabel } from "@/lib/advertiser/creative-status";
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
    return redirectToSignIn();
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
      publishedAt: adCreatives.publishedAt,
      reviewNote: adCreatives.reviewNote,
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
            {creativeStatusLabel(creative.status, creative.reviewNote)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/advertiser/${advertiserId}/creatives`}>Back to ads</Link>
        </Button>
      </div>

      {(creative.status === "rejected" || creative.status === "draft" || creative.status === "suspended") && creative.reviewNote ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Reviewer note:</strong> {creative.reviewNote}
        </div>
      ) : null}

      {creative.status === "draft" || creative.status === "rejected" ? (
        <div className="space-y-2 rounded-md border p-4">
          <p className="text-sm">
            {creative.reviewNote
              ? "Make the changes the reviewer asked for, then resubmit. Our team approves every ad before it appears in the app."
              : "Submit it for review when it's ready. Our team approves every ad before it appears in the app."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/advertiser/${advertiserId}/creatives/${creative.id}/edit`}>Edit</Link>
            </Button>
            <SubmitCreativeButton
              advertiserId={advertiserId}
              creativeId={creative.id}
              label={creative.reviewNote || creative.status === "rejected" ? "Resubmit for review" : "Submit for review"}
            />
          </div>
        </div>
      ) : creative.status === "pending" ? (
        <p className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
          Under review. We&apos;ll email you when our team makes a decision.
        </p>
      ) : creative.status === "approved" ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
          {creative.publishedAt
            ? "Approved and live in the app."
            : "Approved. It isn't in the app yet; we'll publish it."}
        </p>
      ) : creative.status === "suspended" ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          This creative is suspended and isn&apos;t showing in the app.
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
            <dt className="text-muted-foreground w-32 shrink-0">Targeting</dt>
            <dd className="min-w-0 break-words">{describeTarget(creative)}</dd>
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
