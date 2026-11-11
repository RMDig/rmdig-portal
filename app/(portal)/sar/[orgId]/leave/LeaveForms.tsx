"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { giveLeavingNoticeAction, undoLeavingAction, type LeaveResult } from "./actions";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.

function Outcome({ state }: { state: LeaveResult | null }) {
  if (!state) return null;
  if (!state.ok) return <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>;
  return state.synced ? null : (
    <p className="text-sm text-amber-800 dark:text-amber-200">
      Saved. Not every AvAI server has the change yet; rmdig staff have been told and will resend it.
    </p>
  );
}

export function GiveNoticeForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(giveLeavingNoticeAction.bind(null, orgId), null);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" required />
        <span>I understand what leaving does, and I&apos;m giving my team&apos;s leaving notice.</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        Give leaving notice
      </Button>
      <Outcome state={state} />
    </form>
  );
}

export function UndoNoticeForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(undoLeavingAction.bind(null, orgId), null);
  return (
    <form action={action} className="space-y-3">
      <Button type="submit" disabled={pending}>
        Undo leaving notice
      </Button>
      <Outcome state={state} />
    </form>
  );
}
