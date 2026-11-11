"use client";

import { useActionState, useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createDrillUserAction } from "./actions";

// Add a drill user (plan 37 §4.11, P7b): a drill account with no team, for
// linking the AvApp drill build. The server checks the address again, and so
// does the database.
export function DrillUserForm() {
  const [state, formAction, pending] = useActionState(createDrillUserAction, null);
  const id = useId();
  const emailError = state && !state.ok ? state.fieldErrors?.email : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-email`}>Drill address</Label>
          <Input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            placeholder="name+drill2@rmdig.ai"
            aria-invalid={!!emailError}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add drill user"}
        </Button>
      </div>
      {emailError ? (
        <p id={`${id}-email-error`} className="text-xs text-red-700 dark:text-red-400">
          {emailError.join(", ")}
        </p>
      ) : null}
      <div aria-live="polite">
        {state?.ok ? (
          <p className="text-sm">
            {state.emailed
              ? `Added ${state.email}. A link to set its password is on its way (valid 60 minutes).`
              : `Added ${state.email}, but the email didn't send. Use "Forgot password" with that address to get a link.`}
          </p>
        ) : state && !emailError ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
      </div>
    </form>
  );
}
