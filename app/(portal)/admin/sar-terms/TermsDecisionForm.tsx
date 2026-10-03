"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { decideTermsAction } from "./actions";

// Publish or send back one submitted version. Stays mounted across
// revalidation so its result message survives the refresh.
export function TermsDecisionForm({ termsId, blocked, open }: { termsId: string; blocked: boolean; open: boolean }) {
  const [state, action, pending] = useActionState(decideTermsAction, null);
  const [note, setNote] = useState("");

  if (state?.ok) {
    return (
      <p className="text-sm text-green-700">
        {state.decision === "publish" ? `Published as version ${state.version}.` : "Sent back to the team."}
      </p>
    );
  }
  if (!open) return null;
  return (
    <form
      action={action}
      onSubmit={(e) => setNote(String(new FormData(e.currentTarget).get("note") ?? ""))}
      className="space-y-2"
    >
      <input type="hidden" name="termsId" value={termsId} />
      <label className="block text-sm" htmlFor={`note-${termsId}`}>
        Note to the team (required to send back)
      </label>
      <textarea id={`note-${termsId}`} name="note" rows={2} defaultValue={note} className="w-full rounded-md border bg-transparent p-2 text-sm" />
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="publish" disabled={pending || blocked}>
          Publish
        </Button>
        <Button type="submit" name="decision" value="reject" variant="outline" disabled={pending}>
          Send back
        </Button>
      </div>
    </form>
  );
}
