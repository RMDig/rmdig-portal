import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ResendVerificationForm } from "./ResendVerificationForm";

export const metadata = {
  title: "Check your email — rmdig",
};

export default function VerifyEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          We sent you a link. Open it to choose your password and finish setting up your account.
        </p>
        <p className="text-muted-foreground text-sm">
          Didn&apos;t get it, or did the link expire? Check your spam folder, or send a new one.
        </p>
        <Suspense fallback={null}>
          <ResendVerificationForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
