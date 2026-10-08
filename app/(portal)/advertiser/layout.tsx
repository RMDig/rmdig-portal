import { notFound } from "next/navigation";

import { featureEnabled } from "@/lib/features";

// The advertiser portal is off until AvServ ships the ad-creative endpoints
// it publishes to (lib/features.ts). Each action re-checks.
export const dynamic = "force-dynamic";

export default function AdvertiserGate({ children }: { children: React.ReactNode }) {
  if (!featureEnabled("advertiser_portal")) notFound();
  return children;
}
