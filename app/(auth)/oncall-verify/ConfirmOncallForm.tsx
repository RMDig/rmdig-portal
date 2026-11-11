"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { confirmOncallEmailAction } from "./actions";

// The Confirm button: a link a mail scanner opens confirms nothing; a person
// presses this.
export function ConfirmOncallForm({ token, teamName, address }: { token: string; teamName: string; address: string }) {
  const [state, action, pending] = useActionState(confirmOncallEmailAction, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-sm">
        Confirmed. AvAI will email {state.address} with {state.teamName}&apos;s alerts once its terms list email.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">
        Confirm that <span className="font-medium">{address}</span> is an inbox of {teamName}, for AvAI&apos;s search and
        rescue alerts.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Confirming…" : "Confirm this address"}
      </Button>
      <div aria-live="polite">{state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}</div>
    </form>
  );
}
