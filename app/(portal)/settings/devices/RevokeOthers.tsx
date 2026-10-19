"use client";

import { useActionState } from "react";

import { revokeOtherDevicesAction, type RevokeResult } from "./actions";
import { Outcome, RevokeFacts } from "./DeviceRevoke";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface KeepOption {
  deviceId: string;
  label: string;
}

// "Sign out my other phones": the portal can't tell which phone is in the
// user's hand, so they pick the one to keep, or None (rev 2 §3.4). Before
// passkeys every revoke is limited, so the facts shown are the limited ones.
export function RevokeOthers({ phones }: { phones: KeepOption[] }) {
  const [state, action, pending] = useActionState<RevokeResult, FormData>(revokeOtherDevicesAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="keep">Keep signed in</Label>
        <select id="keep" name="keep" required defaultValue="" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
          <option value="" disabled>
            Choose the phone you&apos;re keeping…
          </option>
          {phones.map((p) => (
            <option key={p.deviceId} value={p.deviceId}>
              {p.label}
            </option>
          ))}
          <option value="none">None: sign out every phone</option>
        </select>
      </div>
      <RevokeFacts mode="limited" />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Signing out…" : "Sign out the other phones"}
      </Button>
      {state?.ok ? <p className="text-sm text-green-800 dark:text-green-300">{state.message}</p> : <Outcome state={state} />}
    </form>
  );
}
