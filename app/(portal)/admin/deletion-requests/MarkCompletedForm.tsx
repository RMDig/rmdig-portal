"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { markDeletionCompletedAction, type MarkCompleted } from "./actions";

// The last step of the runbook's deletion procedure: record what was erased
// and where. Done only after the requester has been told (runbook step 5).
export function MarkCompletedForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<MarkCompleted | null, FormData>(markDeletionCompletedAction, null);
  const [note, setNote] = useState("");
  return (
    <form action={action} className="space-y-2 border-t pt-4">
      <input type="hidden" name="requestId" value={requestId} />
      <Label htmlFor={`note-${requestId}`}>What was erased, and where</Label>
      <textarea
        id={`note-${requestId}`}
        name="note"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Portal user deleted; AvServ account and check-outs erased on both nodes; Summit SAR notified."
        className="border-input bg-transparent flex w-full rounded-md border px-3 py-2 text-sm shadow-xs"
      />
      <p className="text-muted-foreground text-xs">
        Mark it completed after you&apos;ve replied to the requester. This closes the request.
      </p>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending || note.trim().length < 10}>
        {pending ? "Saving…" : "Mark completed"}
      </Button>
    </form>
  );
}
