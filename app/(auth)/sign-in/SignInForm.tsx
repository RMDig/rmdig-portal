"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";

import { signInCredentialsAction, signInGoogleAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

// Each points at "Send a new link" on the Check your email page.
const ERROR_MESSAGES: Record<string, string> = {
  "invalid-link": "That verification link is incomplete.",
  "invalid-token": "That verification link isn't valid, or was replaced by a newer one.",
  "expired-token": "That verification link has expired.",
};

export function SignInForm() {
  const params = useSearchParams();
  const verified = params.get("verified") === "true";
  const reset = params.get("reset") === "true";
  const urlError = params.get("error");
  const urlErrorMessage = urlError ? ERROR_MESSAGES[urlError] : null;
  // Where to go after signing in (an invite, an account-review link); the
  // server re-validates it (lib/auth/return-to.ts).
  const next = params.get("next") ?? "";
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  const [state, formAction, pending] = useActionState(signInCredentialsAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const mfaRequired = !!(state && !state.ok && state.mfaRequired);
  const mfaInvalid = !!(state && !state.ok && state.mfaInvalid);

  // React 19 resets uncontrolled fields after every form-action round-trip,
  // which blanked email + password on the transition to the MFA challenge.
  // Fully controlled inputs fixed that but broke password-manager autofill
  // (autofill writes the DOM without reliably firing input events, so React
  // state stayed empty and re-renders wiped the field — "my password isn't
  // recognized"). Instead: keep the inputs UNCONTROLLED so autofill works,
  // capture the submitted values in onSubmit (reads the real DOM via
  // FormData), and let React's post-action reset restore them as
  // defaultValue. The TOTP field stays out of the capture so a wrong code
  // clears itself for the retry.
  const [submitted, setSubmitted] = useState({ email: "", password: "" });

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
          {urlErrorMessage}{" "}
          <Link href={`/verify-email${nextQs}`} className="font-medium underline">
            Get a new link
          </Link>
        </div>
      ) : null}

      <form action={signInGoogleAction}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card text-muted-foreground px-2">or</span>
        </div>
      </div>

      <form
        action={formAction}
        onSubmit={(e) => {
          const fd = new FormData(e.currentTarget);
          setSubmitted({
            email: String(fd.get("email") ?? ""),
            password: String(fd.get("password") ?? ""),
          });
        }}
        className="space-y-4"
      >
        <input type="hidden" name="next" value={next} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={submitted.email}
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
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            defaultValue={submitted.password}
            aria-invalid={!!fieldErrors?.password}
          />
        </div>
        {mfaRequired ? (
          <div className="space-y-2">
            {!mfaInvalid ? (
              <div className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
                {state && !state.ok ? state.error : null}
              </div>
            ) : null}
            <Label htmlFor="totp">Authenticator code</Label>
            <Input
              id="totp"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Enter the 6-digit code from your app, or one of your recovery codes.
            </p>
          </div>
        ) : null}
        {state && !state.ok && (!mfaRequired || mfaInvalid) ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : mfaRequired ? "Verify and sign in" : "Sign in"}
        </Button>
      </form>

      <div className="text-muted-foreground space-y-1 text-center text-sm">
        <p>
          Don&apos;t have an account?{" "}
          <Link href={`/sign-up${nextQs}`} className="font-medium text-foreground underline">
            Sign up
          </Link>
        </p>
        <p>
          <Link href={`/verify-email${nextQs}`} className="underline">
            Didn&apos;t get your verification email?
          </Link>
        </p>
      </div>
    </div>
  );
}
