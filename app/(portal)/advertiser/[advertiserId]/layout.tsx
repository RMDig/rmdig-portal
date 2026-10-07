import { eq } from "drizzle-orm";

import { SectionTabs } from "@/components/nav/SectionTabs";
import { auth } from "@/lib/auth";
import { getAdvertiserRole } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import { advertiserAccounts } from "@/lib/db/schema";
import { advertiserTabs } from "@/lib/nav/sections";

// An advertiser account's pages under one name and one tab bar (Creatives ·
// Team, Team for its admins). Each page still checks access itself.
export default async function AdvertiserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ advertiserId: string }>;
}) {
  const { advertiserId } = await params;
  const userId = (await auth())?.user?.id;
  const role = userId && /^[0-9a-f-]{36}$/i.test(advertiserId) ? await getAdvertiserRole(userId, advertiserId) : null;
  const [account] = role
    ? await db.select({ name: advertiserAccounts.name }).from(advertiserAccounts).where(eq(advertiserAccounts.id, advertiserId)).limit(1)
    : [];
  if (!role || !account) return children;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{account.name}</span> · Advertiser account
        </p>
        <SectionTabs label="Advertiser account" tabs={advertiserTabs(advertiserId, role)} />
      </div>
      {children}
    </div>
  );
}
