import { notFound } from "next/navigation";

import { featureEnabled } from "@/lib/features";

// Restriction reviews call AvServ endpoints that don't exist yet; the queue is
// off until they do (lib/features.ts).
export const dynamic = "force-dynamic";

export default function RestrictionReviewsGate({ children }: { children: React.ReactNode }) {
  if (!featureEnabled("restriction_review")) notFound();
  return children;
}
