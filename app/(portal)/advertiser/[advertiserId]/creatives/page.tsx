import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, advertiserAccounts } from "@/lib/db/schema";
import { CREATIVE_STATUS_LABEL } from "@/lib/advertiser/creative-status";
import { SLOT_LABEL, type BuyableSlot } from "@/lib/advertiser/creative-schema";

export const metadata = {
  title: "Creatives — rmdig",
};

export default async function CreativesPage({
  params,
}: {
  params: Promise<{ advertiserId: string }>;
}) {
  const { advertiserId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  if (!(await isAdvertiserMember(session.user.id, advertiserId))) {
    redirect("/dashboard");
  }

  const [advertiser] = await db
    .select({ name: advertiserAccounts.name, status: advertiserAccounts.status })
    .from(advertiserAccounts)
    .where(eq(advertiserAccounts.id, advertiserId))
    .limit(1);
  if (!advertiser) {
    redirect("/dashboard");
  }

  const creatives = await db
    .select({
      id: adCreatives.id,
      headline: adCreatives.headline,
      slot: adCreatives.slot,
      status: adCreatives.status,
      campaignName: adCampaigns.name,
      createdAt: adCreatives.createdAt,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(eq(adCampaigns.advertiserId, advertiserId))
    .orderBy(desc(adCreatives.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{advertiser.name}</h1>
          <p className="text-muted-foreground mt-1">Creatives.</p>
        </div>
        {advertiser.status === "active" ? (
          <Button asChild size="sm">
            <Link href={`/advertiser/${advertiserId}/creatives/new`}>New creative</Link>
          </Button>
        ) : null}
      </div>

      {creatives.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
          No creatives yet. Create one to preview it and submit it for review.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {creatives.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <Link
                href={`/advertiser/${advertiserId}/creatives/${c.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <p className="truncate font-medium">{c.headline}</p>
                <p className="text-muted-foreground text-sm">
                  {c.campaignName} · {SLOT_LABEL[c.slot as BuyableSlot] ?? c.slot}
                </p>
              </Link>
              <span className="text-muted-foreground shrink-0 text-sm">
                {CREATIVE_STATUS_LABEL[c.status] ?? c.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
