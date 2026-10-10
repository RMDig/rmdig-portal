"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { finishSignUpAction } from "../../actions";
import { nextQuery } from "@/lib/auth/return-to";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function FinishSignUpForm({ email, token, next }: { email: string; token: string; next: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(finishSignUpAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      router.push(`/sign-in?verified=true${nextQuery(next, "&")}`);
    }
  }, [state, router, next]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      {/* Lets a password manager save the new password against the address. */}
      <input type="hidden" name="username" autoComplete="username" value={email} />
      <p className="text-muted-foreground text-sm">
        Your email <span className="text-foreground font-medium">{email}</span> is confirmed once you
        set a password.
      </p>

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
          <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.password.join(", ")}</p>
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
          <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.confirmPassword.join(", ")}</p>
        ) : null}
      </div>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
