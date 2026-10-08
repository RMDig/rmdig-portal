import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { featureEnabled } from "@/lib/features";
import { SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";

// Restriction reviews call AvServ endpoints that don't exist yet, so the form
// is off (lib/features.ts). The link can still arrive from an AvAI notice, so
// say where to go instead of a bare 404.
export const dynamic = "force-dynamic";

export default function AccountReviewGate({ children }: { children: React.ReactNode }) {
  if (featureEnabled("restriction_review")) return children;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account review</CardTitle>
        <CardDescription>
          Account reviews in the portal aren&apos;t open yet. To ask about a restriction on your AvAI
          account, write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
