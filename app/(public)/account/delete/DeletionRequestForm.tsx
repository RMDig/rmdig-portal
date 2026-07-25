"use client";

import { useActionState } from "react";

import { requestDataDeletionAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeletionRequestForm() {
  const [state, formAction, pending] = useActionState(requestDataDeletionAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-900 dark:text-green-200">
        Check your inbox — we&apos;ve sent a confirmation link to that address. Your
        deletion request starts once you click it. The link expires in 24 hours.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!fieldErrors?.email}
        />
        {fieldErrors?.email ? (
          <p className="text-xs text-red-700">{fieldErrors.email.join(", ")}</p>
        ) : null}
      </div>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send confirmation email"}
      </Button>
    </form>
  );
}
