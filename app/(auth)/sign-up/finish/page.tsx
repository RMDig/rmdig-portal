import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkSignUpLink } from "@/lib/auth/email-first-signup";
import { nextQuery, safeReturnTo } from "@/lib/auth/return-to";

import { FinishSignUpForm } from "./FinishSignUpForm";

export const metadata = {
  title: "Choose your password — rmdig",
};

// The page the verification email opens (email-first sign-up). Rendering it
// only checks the link; the token is used up when the form is submitted.
export default async function FinishSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string; next?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const email = params.email?.toLowerCase();
  const next = safeReturnTo(params.next ?? null);
  const state = token && email ? await checkSignUpLink(email, token) : "invalid";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{state === "ok" ? "Choose your password" : "This link can't be used"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === "ok" && token && email ? (
          <FinishSignUpForm email={email} token={token} next={next ?? ""} />
        ) : (
          <>
            <p className="text-sm text-red-700 dark:text-red-400">
              {state === "expired"
                ? "This link has expired."
                : "This link isn't valid. It may have been used already, or replaced by a newer one."}
            </p>
            <p className="text-muted-foreground text-center text-sm">
              <Link href={`/verify-email${nextQuery(next)}`} className="text-foreground font-medium underline">
                Send a new link
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
