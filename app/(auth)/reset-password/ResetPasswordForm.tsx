"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { resetPasswordAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(resetPasswordAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      router.push("/sign-in?reset=true");
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
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
        <Label htmlFor="confirmPassword">Confirm new password</Label>
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
        {pending ? "Saving…" : "Set new password"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        <Link href="/sign-in" className="text-foreground font-medium underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
