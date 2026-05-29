import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
          We sent you a verification link. Click it to finish setting up your account, then come
          back and sign in.
        </p>
        <p className="text-muted-foreground text-sm">
          Didn&apos;t get the email? Check your spam folder, or{" "}
          <Link href="/sign-up" className="text-foreground underline">
            try signing up again
          </Link>{" "}
          — same email is fine.
        </p>
      </CardContent>
    </Card>
  );
}
