import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, advertiserAccounts } from "@/lib/db/schema";
import { AdApprovalRow, type PendingCreative } from "./AdApprovalRow";

export const metadata = {
  title: "Ad approvals — rmdig",
};

// Reviewable states, in display priority (pending first — those need action).
// Draft creatives haven't been submitted; rejected ones are terminal — both omitted.
const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, suspended: 2 };

export default async function AdApprovalsPage() {
  // The /admin route is staff-gated; re-check here so a direct URL can't reach the
  // queue, and so a write can never trust the layout.
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }
  const roles = await getPlatformRoles(session.user.id);
  if (roles.length === 0) {
    redirect("/dashboard");
  }

  const reviewable = await db
    .select({
      id: adCreatives.id,
      headline: adCreatives.headline,
      body: adCreatives.body,
      altText: adCreatives.altText,
      clickUrl: adCreatives.clickUrl,
      slot: adCreatives.slot,
      status: adCreatives.status,
      submittedAt: adCreatives.submittedAt,
      campaignName: adCampaigns.name,
      advertiserName: advertiserAccounts.name,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, adCampaigns.advertiserId))
    .where(inArray(adCreatives.status, ["pending", "approved", "suspended"]))
    .orderBy(asc(adCreatives.submittedAt));

  const rows: PendingCreative[] = reviewable.map((c) => ({
    ...c,
    submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null,
  }));
  // Pending first (they need action), then approved, then suspended.
  rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ad approvals</h1>
        <p className="text-muted-foreground mt-1">
          {pendingCount} creative{pendingCount === 1 ? "" : "s"} awaiting review
          {rows.length > pendingCount ? ` · ${rows.length - pendingCount} approved or suspended` : ""}.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border px-4 py-8 text-center text-sm">
          No creatives to review right now.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((creative) => (
            <AdApprovalRow key={creative.id} creative={creative} />
          ))}
        </ul>
      )}
    </div>
  );
}
