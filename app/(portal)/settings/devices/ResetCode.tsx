"use client";

import { useActionState } from "react";

import { mintResetCodeAction, type ResetCodeResult } from "./actions";
import { Outcome } from "./DeviceRevoke";
import { REVOKE_COPY } from "./revoke-copy";
import { Button } from "@/components/ui/button";

// "Get an App Lock reset code" for one phone. The code is shown once, here,
// and never stored by the portal (AvServ keeps only its hash).
export function ResetCode({ deviceId }: { deviceId: string }) {
  const [state, action, pending] = useActionState<ResetCodeResult, FormData>(mintResetCodeAction, null);

  if (state?.ok) {
    return (
      <div className="w-full space-y-2 rounded-md border p-3 text-sm">
        <p className="text-muted-foreground">{REVOKE_COPY.resetCodeWhat}</p>
        <p className="bg-muted rounded-md px-4 py-3 text-center font-mono text-2xl tracking-widest">
          {state.code.slice(0, 4)}-{state.code.slice(4)}
        </p>
        <p className="text-muted-foreground">
          Use it before {state.expiresText}. {REVOKE_COPY.resetCodeOnce}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-1 text-right">
      <input type="hidden" name="deviceId" value={deviceId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Making a code…" : "Get an App Lock reset code"}
      </Button>
      <Outcome state={state} />
    </form>
  );
}
