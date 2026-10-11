"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { confirmDeletionAction } from "./actions";

// The token rides as a hidden field, never a request id: request ids are shown
// to people, so an id-keyed action would let anyone confirm anyone's request.
export function ConfirmDeletionForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmDeletionAction, null);
  return (
    <form action={action} className="mt-6 max-w-md space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="confirm-email">Email address</Label>
        <Input id="confirm-email" name="email" type="email" autoComplete="email" required />
      </div>
      {state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Confirming…" : "Confirm deletion"}
      </Button>
    </form>
  );
}
