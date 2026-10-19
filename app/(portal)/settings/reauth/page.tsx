import Link from "next/link";

import { ReauthForm } from "./ReauthForm";
import { auth } from "@/lib/auth";
import { reauthOptions } from "@/lib/auth/reauth";
import { safeReturnTo } from "@/lib/auth/return-to";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Confirm it's you — rmdig",
};

// Asked before actions that an abuser holding a signed-in browser must not
// reach (plan 36 §3.4). Passing it counts for 10 minutes on this browser.
// Password (and code) only: see lib/auth/reauth.ts for why not Google.
export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const returnTo = safeReturnTo((await searchParams).returnTo) ?? "/settings";
  const options = await reauthOptions(session.user.id);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Confirm it&apos;s you</CardTitle>
          <CardDescription>
            {options.password
              ? options.mfa
                ? "This change needs a fresh sign-in. Enter your password and a code from your authenticator app."
                : "This change needs a fresh sign-in. Enter your password."
              : "This change needs a password, and your account signs in with Google only."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {options.password ? (
            <ReauthForm returnTo={returnTo} mfa={options.mfa} passkey={options.passkey} />
          ) : (
            <p className="text-sm leading-6">
              Set a password first: we&apos;ll email you a link.{" "}
              <Link href="/forgot-password" className="font-medium underline">
                Set a password
              </Link>
              . Setting it signs you out everywhere, so sign back in with it, then return here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
