"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { signInCredentialsAction, signInGoogleAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-link": "That verification link is malformed. Try signing up again.",
  "invalid-token": "That verification link isn't valid. Try requesting a new one.",
  "expired-token": "That verification link has expired. Sign up again to get a new one.",
};

export function SignInForm() {
  const params = useSearchParams();
  const verified = params.get("verified") === "true";
  const reset = params.get("reset") === "true";
  const urlError = params.get("error");
  const urlErrorMessage = urlError ? ERROR_MESSAGES[urlError] : null;

  const [state, formAction, pending] = useActionState(signInCredentialsAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="space-y-6">
      {verified ? (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
          Email verified. You can sign in now.
        </div>
      ) : null}
      {reset ? (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
          Password updated. Sign in with your new password.
        </div>
      ) : null}
      {urlErrorMessage ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
          {urlErrorMessage}
        </div>
      ) : null}

      <form action={signInGoogleAction}>
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">or</span>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
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
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-xs underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!fieldErrors?.password}
          />
        </div>
        {state && !state.ok ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
