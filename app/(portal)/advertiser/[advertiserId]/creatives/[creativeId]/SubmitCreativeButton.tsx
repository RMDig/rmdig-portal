"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { submitCreativeForReviewAction } from "./actions";

// Submit / resubmit a creative for review. Shown only for draft or rejected
// creatives (the page decides). On success the page revalidates and the status
// flips to "Under review".
export function SubmitCreativeButton({
  advertiserId,
  creativeId,
  label,
}: {
  advertiserId: string;
  creativeId: string;
  label: string;
}) {
  const action = submitCreativeForReviewAction.bind(null, advertiserId, creativeId);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : label}
      </Button>
      {state && !state.ok ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
    </form>
  );
}
