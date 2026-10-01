"use client";

import { useActionState, useState } from "react";

import { submitReviewRequestAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { REVIEW_MESSAGE_MAX, REVIEW_MESSAGE_MIN } from "@/lib/restrictions/review";

// One review request. The submission key comes from the server render, so a
// double click or a retry after an error is the same request. React 19 resets
// uncontrolled fields after every action; the message is captured on submit
// and restored through defaultValue (see app/(auth)/sign-in/SignInForm.tsx).
export function ReviewRequestForm({
  restrictionId,
  submissionKey,
}: {
  restrictionId: string;
  submissionKey: string;
}) {
  const [state, formAction, pending] = useActionState(submitReviewRequestAction, null);
  const [message, setMessage] = useState("");
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
        Thanks. Your request is with our team, and we&apos;ll email you when it&apos;s decided.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => setMessage(String(new FormData(e.currentTarget).get("message") ?? ""))}
      className="space-y-3"
    >
      <input type="hidden" name="restrictionId" defaultValue={restrictionId} />
      <input type="hidden" name="submissionKey" defaultValue={submissionKey} />
      <div className="space-y-2">
        <Label htmlFor={`review-message-${restrictionId}`}>Ask for a review</Label>
        <textarea
          id={`review-message-${restrictionId}`}
          name="message"
          defaultValue={message}
          rows={5}
          minLength={REVIEW_MESSAGE_MIN}
          maxLength={REVIEW_MESSAGE_MAX}
          required
          aria-invalid={!!fieldErrors?.message}
          placeholder="Tell us what happened, for example why recent automatic alerts were false alarms."
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {fieldErrors?.message ? (
          <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.message.join(", ")}</p>
        ) : null}
      </div>
      {state && !state.ok && !fieldErrors?.message ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send review request"}
      </Button>
    </form>
  );
}
