"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { signUpAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function SignUpForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signUpAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      router.push("/verify-email");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="intent">What brings you to AvAI?</Label>
        {/* Routing hint only — after email verification, SAR/advertiser picks
            land on their onboarding form. Native select styled like Input (the
            repo has no shadcn Select primitive; not worth adding for one field). */}
        <select
          id="intent"
          name="intent"
          defaultValue="explorer"
          className="border-input bg-transparent dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring md:text-sm"
        >
          <option value="explorer">Explorer — I use the AvAI app</option>
          <option value="sar">Search &amp; Rescue — I represent a SAR team</option>
          <option value="advertiser">Advertiser — I want to advertise on AvAI</option>
        </select>
      </div>

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
          <p className="text-xs text-red-700 dark:text-red-400">
            {fieldErrors.email.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={!!fieldErrors?.password}
        />
        <p className="text-muted-foreground text-xs">At least 12 characters.</p>
        {fieldErrors?.password ? (
          <p className="text-xs text-red-700 dark:text-red-400">
            {fieldErrors.password.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={!!fieldErrors?.confirmPassword}
        />
        {fieldErrors?.confirmPassword ? (
          <p className="text-xs text-red-700 dark:text-red-400">
            {fieldErrors.confirmPassword.join(", ")}
          </p>
        ) : null}
      </div>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-foreground font-medium underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
