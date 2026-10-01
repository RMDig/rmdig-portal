"use client";

import { useActionState, useState } from "react";

import { decideReviewAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

// Uphold or lift (or close, once AvAI already lifted it). The note is required
// for every decision and lands in the audit log; the user never sees it. The
// note survives React 19's post-action form reset via capture-on-submit.
export function DecisionForm({
  requestId,
  open,
  inForce,
}: {
  requestId: string;
  open: boolean;
  inForce: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideReviewAction, null);
  const [note, setNote] = useState("");
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p className="rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
        Decision recorded.
        {state.emailFailed
          ? " The email to the user failed; it's logged. Reach them another way."
          : ""}
      </p>
    );
  }
  if (!open) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decide</CardTitle>
        <CardDescription>
          {inForce
            ? "Lift restores the feature in AvAI, which emails the user. Uphold keeps it and emails them from here."
            : "AvAI shows this restriction already lifted. Close the request with a note."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          onSubmit={(e) => setNote(String(new FormData(e.currentTarget).get("note") ?? ""))}
          className="space-y-3"
        >
          <input type="hidden" name="requestId" defaultValue={requestId} />
          <div className="space-y-2">
            <Label htmlFor="decision-note">Note (audit log, staff-only)</Label>
            <textarea
              id="decision-note"
              name="note"
              defaultValue={note}
              rows={4}
              maxLength={1000}
              required
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {fieldErrors?.note ? (
              <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.note.join(", ")}</p>
            ) : null}
          </div>
          {state && !state.ok && !fieldErrors?.note ? (
            <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {inForce ? (
              <>
                <Button type="submit" name="decision" value="lift" disabled={pending}>
                  Lift
                </Button>
                <Button type="submit" name="decision" value="uphold" variant="outline" disabled={pending}>
                  Uphold
                </Button>
              </>
            ) : (
              <Button type="submit" name="decision" value="close" disabled={pending}>
                Close
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
