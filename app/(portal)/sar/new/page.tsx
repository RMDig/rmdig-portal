import { phoneVerificationEnabled } from "@/lib/phone/verify";

import { SarOrgForm } from "./SarOrgForm";

export const metadata = {
  title: "Register a search & rescue team or ski patrol — rmdig",
};

export default function SarNewPage() {
  // Auth + MFA are enforced by the (portal) layout; createSarOrgAction re-checks
  // auth and email verification on submit (never trust a layout to gate a write).
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register a search &amp; rescue team or ski patrol</h1>
        <p className="text-muted-foreground mt-1">
          Tell us about your team, draw your service area, and attach proof of operating status.
          We&apos;ll review your application before approving it.
        </p>
      </div>
      <SarOrgForm phoneVerifyEnabled={phoneVerificationEnabled()} />
    </div>
  );
}
