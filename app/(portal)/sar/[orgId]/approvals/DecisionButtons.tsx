"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { decideAction } from "./actions";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.

export function DecisionButtons({
  orgId,
  acceptanceId,
  decisions,
}: {
  orgId: string;
  acceptanceId: string;
  decisions: Array<{ state: "approved" | "declined"; label: string }>;
}) {
  const [state, action, pending] = useActionState(decideAction.bind(null, orgId), null);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => (
          <form key={d.state} action={action}>
            <input type="hidden" name="acceptanceId" value={acceptanceId} />
            <input type="hidden" name="state" value={d.state} />
            <Button type="submit" size="sm" variant={d.state === "approved" ? "default" : "outline"} disabled={pending}>
              {d.label}
            </Button>
          </form>
        ))}
      </div>
      {state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
    </div>
  );
}
