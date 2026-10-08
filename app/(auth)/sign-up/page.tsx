import Image from "next/image";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { featureEnabled } from "@/lib/features";
import { SignUpForm } from "./SignUpForm";

export const metadata = {
  title: "Sign up — rmdig",
};

export default function SignUpPage() {
  return (
    <Card>
      {/* Mirrors the sign-in card: grid header, so justify-items-center does
          the horizontal centering. */}
      <CardHeader className="justify-items-center text-center">
        <Image
          src="/rmdig-logo.png"
          alt="RMDig"
          width={136}
          height={40}
          priority
          className="mb-2"
        />
        <CardTitle>Create your rmdig account</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          {/* No advertiser choice while the advertiser portal is off (lib/features.ts). */}
          <SignUpForm advertiserOption={featureEnabled("advertiser_portal")} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
