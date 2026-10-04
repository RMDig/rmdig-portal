"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { ackAlertAction } from "./actions";

// "Mark received" for one alert. Stays mounted across revalidation so the
// outcome survives the refresh.
export function AckButton({ orgId, alertId }: { orgId: string; alertId: string }) {
  const [state, action, pending] = useActionState(ackAlertAction.bind(null, orgId), null);
  if (state?.ok) return <p className="text-sm text-green-700">Marked received.</p>;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="alertId" value={alertId} />
      <Button type="submit" size="sm" disabled={pending}>
        Mark received
      </Button>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
