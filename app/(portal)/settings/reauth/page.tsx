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
export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo) ?? "/settings";
  const options = await reauthOptions(session.user.id);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Confirm it&apos;s you</CardTitle>
          <CardDescription>
            This change needs a fresh sign-in.{" "}
            {options.password
              ? options.mfa
                ? "Enter your password and a code from your authenticator app."
                : "Enter your password."
              : "Sign in with Google again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.error === "google" ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              Google didn&apos;t confirm a fresh sign-in. Try again.
            </p>
          ) : null}
          <ReauthForm returnTo={returnTo} {...options} />
        </CardContent>
      </Card>
    </div>
  );
}
