import { notFound } from "next/navigation";

import { featureEnabled } from "@/lib/features";

// Advertiser invitations belong to the advertiser portal, which is off until
// AvServ ships the ad-creative endpoints (lib/features.ts).
export const dynamic = "force-dynamic";

export default function AdvertiserInviteGate({ children }: { children: React.ReactNode }) {
  if (!featureEnabled("advertiser_portal")) notFound();
  return children;
}
