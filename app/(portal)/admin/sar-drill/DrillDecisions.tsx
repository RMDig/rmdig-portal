"use client";

import { useActionState } from "react";

import { SuspendConfirm } from "@/components/sar/SuspendConfirm";
import { Button } from "@/components/ui/button";

import { reviewSarOrgAction } from "../sar-approvals/actions";
import { activateDrillOrgAction } from "./actions";

// The decisions a drill team takes (plan 37 §4.6): Activate from pending, the
// operator's own logged decision; Suspend and Move back to pending through the
// ordinary staff action, which works for a drill team as for a real one. Never
// Approve: the review action refuses a drill team. Suspend is behind a confirm:
// after Activate the page reloads with it in the same spot (SuspendConfirm).

type Props = { orgId: string; orgName: string; revision: number; status: string; canActivate: boolean; canSuspend: boolean };

export function DrillDecisions({ orgId, orgName, revision, status, canActivate, canSuspend }: Props) {
  const [activated, activate, activating] = useActionState(activateDrillOrgAction, null);
  const [reviewed, review, reviewing] = useActionState(reviewSarOrgAction, null);
  const error = (activated && !activated.ok ? activated.error : null) ?? (reviewed && !reviewed.ok ? reviewed.error : null);

  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="revision" value={revision} />
    </>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "pending" && canActivate ? (
          <form action={activate}>
            {hidden}
            <Button type="submit" size="sm" disabled={activating}>
              {activating ? "Activating…" : "Activate drill team"}
            </Button>
          </form>
        ) : null}
        {status === "approved" && canSuspend ? (
          <SuspendConfirm formAction={review} orgId={orgId} orgName={orgName} revision={revision} pending={reviewing} isDrill size="sm" />
        ) : null}
        {status === "suspended" && canSuspend ? (
          <form action={review}>
            {hidden}
            <input type="hidden" name="decision" value="reactivate" />
            <Button type="submit" size="sm" variant="outline" disabled={reviewing}>
              Move back to pending
            </Button>
          </form>
        ) : null}
      </div>
      {status === "pending" && canActivate ? (
        <p className="text-muted-foreground text-xs">
          Logged as &quot;drill org activated by the operator; not an independent review&quot;. It needs a
          drill login with the admin role, and syncs once the team has published terms.
        </p>
      ) : null}
      <div aria-live="polite">{error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}</div>
    </div>
  );
}
