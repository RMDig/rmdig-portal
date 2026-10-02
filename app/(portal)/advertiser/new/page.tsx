import { phoneVerificationEnabled } from "@/lib/phone/verify";

import { AdvertiserForm } from "./AdvertiserForm";

export const metadata = {
  title: "Create an advertiser account — rmdig",
};

export default function AdvertiserNewPage() {
  // Auth + MFA are enforced by the (portal) layout; createAdvertiserAccountAction
  // re-checks auth and email verification on submit (never trust a layout to gate
  // a write).
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an advertiser account</h1>
        <p className="text-muted-foreground mt-1">
          Sponsor ads help fund the platform while keeping the app free. Tell us who you are — then
          you can author creatives and submit them for review. Every creative is manually reviewed
          before it appears in the app.
        </p>
      </div>
      <AdvertiserForm phoneVerifyEnabled={phoneVerificationEnabled()} />
    </div>
  );
}
