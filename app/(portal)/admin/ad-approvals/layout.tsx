import { notFound } from "next/navigation";

import { featureEnabled } from "@/lib/features";

// Ad approvals publish to AvServ endpoints that don't exist yet; the queue is
// off with the rest of the advertiser portal (lib/features.ts).
export const dynamic = "force-dynamic";

export default function AdApprovalsGate({ children }: { children: React.ReactNode }) {
  if (!featureEnabled("advertiser_portal")) notFound();
  return children;
}
