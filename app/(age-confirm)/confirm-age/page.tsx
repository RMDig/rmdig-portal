import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { ageConfirmed } from "@/lib/auth/age-gate";
import { safeReturnTo } from "@/lib/auth/return-to";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { ConfirmAgeForm } from "./ConfirmAgeForm";

export const metadata: Metadata = { title: "Confirm your age — rmdig" };

export default async function ConfirmAgePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const next = safeReturnTo((await searchParams).next) ?? "";
  if (await ageConfirmed(session.user.id)) redirect(next || "/dashboard");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Confirm your age</h1>
        <p className="text-muted-foreground text-sm">
          AvAI accounts are for people 18 and older. Confirm this once to keep using your
          account. See our{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
      <ConfirmAgeForm next={next} />
      <div className="text-muted-foreground space-y-1 border-t pt-4 text-sm">
        <p className="text-foreground font-medium">If you&apos;re under 18</p>
        <p>
          You can&apos;t use an AvAI account. Sign out, and if you&apos;d like your data
          removed,{" "}
          <Link href="/account/delete" className="underline">
            request deletion
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
