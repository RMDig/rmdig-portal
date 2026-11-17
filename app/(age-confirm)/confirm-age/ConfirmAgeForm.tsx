"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAgeAction } from "./actions";

export function ConfirmAgeForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(confirmAgeAction, null);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="ageConfirmed" required className="mt-1 size-4" />
        <span>I am 18 or older.</span>
      </label>
      {state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
