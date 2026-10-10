"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { dismissPasswordClearedNoticeAction } from "./actions";

// Shown once, until dismissed, after a Google sign-in landed on this account
// while its email was unverified and removed the password set on it.
export function PasswordClearedNotice() {
  const [state, dismiss, pending] = useActionState(dismissPasswordClearedNoticeAction, null);
  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-900/10">
      <CardHeader className="space-y-3">
        <CardTitle>We removed this account&apos;s password</CardTitle>
        <CardDescription>
          You signed in with Google before this email address had been confirmed, so we removed the
          password that had been set on the account. Anyone who knew it can no longer use it. You can
          keep signing in with Google, or{" "}
          <Link href="/forgot-password" className="text-foreground font-medium underline">
            set a new password
          </Link>
          .
        </CardDescription>
        <form action={dismiss} className="flex items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Dismissing…" : "Got it"}
          </Button>
          {state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
        </form>
      </CardHeader>
    </Card>
  );
}
