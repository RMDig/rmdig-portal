"use client";

import Link from "next/link";
import { useActionState } from "react";

import { changePasswordAction, updateDisplayNameAction } from "./account-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function DisplayNameCard({ displayName }: { displayName: string }) {
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display name</CardTitle>
        <CardDescription>The name shown across the portal.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName" className="sr-only">
              Display name
            </Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={displayName}
              maxLength={100}
              required
              aria-invalid={!!fieldErrors?.displayName}
            />
            {fieldErrors?.displayName ? (
              <p className="text-xs text-red-700 dark:text-red-400">
                {fieldErrors.displayName.join(", ")}
              </p>
            ) : null}
          </div>
          {state?.ok ? (
            <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>
          ) : null}
          {state && !state.ok && !fieldErrors ? (
            <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change the password you use to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasPassword ? (
          <p className="text-muted-foreground text-sm">
            Your account signs in with Google and has no password.{" "}
            <Link href="/forgot-password" className="text-foreground font-medium underline">
              Email yourself a link to add one
            </Link>
            . Setting it signs you out everywhere.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <PasswordInput
                id="currentPassword"
                name="currentPassword"
                autoComplete="current-password"
                required
                aria-invalid={!!fieldErrors?.currentPassword}
              />
              {fieldErrors?.currentPassword ? (
                <p className="text-xs text-red-700 dark:text-red-400">
                  {fieldErrors.currentPassword.join(", ")}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Forgot your current password?{" "}
                <Link href="/forgot-password" className="text-foreground underline">
                  Email yourself a reset link
                </Link>
                .
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <PasswordInput
                id="newPassword"
                name="newPassword"
                autoComplete="new-password"
                required
                minLength={12}
                aria-invalid={!!fieldErrors?.newPassword}
              />
              <p className="text-muted-foreground text-xs">At least 12 characters.</p>
              {fieldErrors?.newPassword ? (
                <p className="text-xs text-red-700 dark:text-red-400">
                  {fieldErrors.newPassword.join(", ")}
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
            {state?.ok ? (
              <p className="text-sm text-green-700 dark:text-green-400">Password updated.</p>
            ) : null}
            {state && !state.ok && !fieldErrors ? (
              <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
