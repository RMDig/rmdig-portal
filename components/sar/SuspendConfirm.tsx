"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SUSPEND_COPY } from "@/lib/sar/suspend-copy";

// Suspend behind a confirm, for the approvals queue and Drill teams. The first
// click only opens the panel. The panel puts the warning first and Cancel
// before the destructive button, so a repeated click on the trigger's spot
// lands on neither.

type Props = {
  formAction: (fd: FormData) => void;
  orgId: string;
  orgName: string;
  revision: number;
  pending: boolean;
  isDrill: boolean;
  /** Offer the optional note (the approvals queue records one). */
  withNote?: boolean;
  /** Start open; for tests of the panel. */
  initiallyOpen?: boolean;
  size?: "sm" | "default";
};

export function SuspendConfirm({ formAction, orgId, orgName, revision, pending, isDrill, withNote = false, initiallyOpen = false, size = "default" }: Props) {
  const [open, setOpen] = useState(initiallyOpen);

  if (!open) {
    return (
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}>
        {SUSPEND_COPY.trigger}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-md border border-amber-300 p-3 sm:max-w-md dark:border-amber-700">
      <div className="space-y-1 text-sm leading-6">
        <p className="font-medium">{SUSPEND_COPY.heading(orgName)}</p>
        <p>{SUSPEND_COPY.effect}</p>
        <p className="text-muted-foreground">{isDrill ? SUSPEND_COPY.undo.drill : SUSPEND_COPY.undo.real}</p>
      </div>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="decision" value="suspend" />
        {withNote ? (
          <textarea
            name="note"
            rows={2}
            placeholder={SUSPEND_COPY.notePlaceholder}
            className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size={size} onClick={() => setOpen(false)} disabled={pending}>
            {SUSPEND_COPY.cancel}
          </Button>
          <Button type="submit" variant="destructive" size={size} disabled={pending}>
            {pending ? "Suspending…" : SUSPEND_COPY.confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}
