"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { capacityText, formatCount, MAX_ACTIVE_CHECKOUTS, MODE_TEXT } from "@/lib/sar/capacity";

import { saveAcceptanceModeAction, saveCapacityAction, type SaveSettingResult } from "./actions";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.

function Outcome<T>({ state, saved }: { state: SaveSettingResult<T> | null; saved: (v: T) => string }) {
  if (!state) return null;
  if (!state.ok) return <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>;
  if (state.sync === "unchanged") return <p className="text-muted-foreground text-sm">That&apos;s already your team&apos;s setting.</p>;
  const text = `Saved: ${saved(state.value)}.`;
  if (state.sync === "later") return <p className="text-sm text-green-700 dark:text-green-300">{text} It takes effect once your team is approved.</p>;
  if (state.sync === "partial") {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {text} Not every AvAI server has it yet; the portal sends it again within a few minutes, and rmdig staff have been told.
      </p>
    );
  }
  return <p className="text-sm text-green-700 dark:text-green-300">{text} Every AvAI server has it.</p>;
}

export function CapacityForm({ orgId, cap }: { orgId: string; cap: number | null }) {
  const [state, action, pending] = useActionState(saveCapacityAction.bind(null, orgId), null);
  const fieldError = state && !state.ok ? state.fieldError : undefined;
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
      <Outcome state={state} saved={(v) => capacityText(v).toLowerCase()} />
    </form>
  );
}

export function AcceptanceModeForm({ orgId, mode }: { orgId: string; mode: "open" | "confirm_first" }) {
  const [state, action, pending] = useActionState(saveAcceptanceModeAction.bind(null, orgId), null);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Who can name your team on a check-out</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="acceptanceMode" value="open" defaultChecked={mode === "open"} className="mt-1" />
          <span>
            <span className="block">Anyone who accepts your terms</span>
            <span className="text-muted-foreground block">They can name your team as soon as they accept.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="acceptanceMode" value="confirm_first" defaultChecked={mode === "confirm_first"} className="mt-1" />
          <span>
            <span className="block">Only people your team approves</span>
            <span className="text-muted-foreground block">
              Each new acceptance waits on your Approvals tab, and the person can&apos;t name your team until you approve
              it. People who accepted before you switch stay approved.
            </span>
          </span>
        </label>
      </fieldset>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Outcome state={state} saved={(v) => MODE_TEXT[v]} />
    </form>
  );
}
