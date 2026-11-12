"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { capacityText, formatCount, MAX_ACTIVE_CHECKOUTS } from "@/lib/sar/capacity";

import { saveCapacityAction, type SaveCapacityResult } from "./actions";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.

function Outcome({ state }: { state: SaveCapacityResult | null }) {
  if (!state) return null;
  if (!state.ok) return <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>;
  const saved = `Saved: ${capacityText(state.cap).toLowerCase()}.`;
  if (state.sync === "unchanged") return <p className="text-muted-foreground text-sm">That&apos;s already your team&apos;s limit.</p>;
  if (state.sync === "later") return <p className="text-sm text-green-700 dark:text-green-300">{saved} It takes effect once your team is approved.</p>;
  if (state.sync === "partial") {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {saved} Not every AvAI server has it yet; the portal sends it again within a few minutes, and rmdig staff have been told.
      </p>
    );
  }
  return <p className="text-sm text-green-700 dark:text-green-300">{saved} Every AvAI server has it.</p>;
}

export function CapacityForm({ orgId, cap }: { orgId: string; cap: number | null }) {
  const [state, action, pending] = useActionState(saveCapacityAction.bind(null, orgId), null);
  const fieldError = state && !state.ok ? state.fieldErrors?.maxActiveCheckouts?.[0] : undefined;
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        <span className="font-medium">Most check-outs at once</span>
        <input
          name="maxActiveCheckouts"
          inputMode="numeric"
          defaultValue={cap === null ? "" : String(cap)}
          placeholder="No limit"
          maxLength={String(MAX_ACTIVE_CHECKOUTS).length}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="capacity-help"
          className="border-input mt-1 flex h-9 w-36 rounded-md border px-3 py-1 text-sm"
        />
      </label>
      <p id="capacity-help" className="text-muted-foreground text-sm">
        A whole number from 1 to {formatCount(MAX_ACTIVE_CHECKOUTS)}, or blank for no limit.
      </p>
      <Button type="submit" size="sm" disabled={pending}>
        Save limit
      </Button>
      <Outcome state={state} />
    </form>
  );
}
