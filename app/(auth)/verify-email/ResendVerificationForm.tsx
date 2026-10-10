"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { resendVerificationAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "Send a new link": for a sign-up that was never finished. The answer is the
// same whether or not the address has an account, so it can't be used to
// probe for accounts.
export function ResendVerificationForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(resendVerificationAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="resend-email">Email you signed up with</Label>
        <Input id="resend-email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.ok ? (
        <p className="text-sm text-green-800 dark:text-green-300">
          If that address has an account that isn&apos;t verified yet, we&apos;ve sent it a new link. It
          replaces any earlier one.
        </p>
      ) : state && !state.ok ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Sending…" : "Send a new link"}
      </Button>
    </form>
  );
}
