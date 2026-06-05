"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordResetAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  // Neutral confirmation — never reveals whether the email had an account.
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
          If an account exists for that email, we&apos;ve sent a password-reset link. Check your
          inbox — the link expires in 60 minutes.
        </div>
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/sign-in" className="text-foreground font-medium underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Enter the email for your account and we&apos;ll send you a link to reset your password.
      </p>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!fieldErrors?.email}
        />
        {fieldErrors?.email ? (
          <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.email.join(", ")}</p>
        ) : null}
      </div>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Remembered it?{" "}
        <Link href="/sign-in" className="text-foreground font-medium underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
