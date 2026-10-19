"use client";

import { useActionState } from "react";

import { reauthPasskeyOptionsAction, reauthWithPasswordAction } from "./actions";
import { PasskeyFactorButton } from "@/components/auth/PasskeyFactorButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function ReauthForm({ returnTo, mfa, passkey }: { returnTo: string; mfa: boolean; passkey: boolean }) {
  const [state, action, pending] = useActionState(reauthWithPasswordAction, null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      {mfa ? (
        <div className="space-y-2">
          <Label htmlFor="code">Authenticator or recovery code</Label>
          {/* Not `required`: a passkey answers instead of the code. */}
          <Input id="code" name="code" autoComplete="one-time-code" inputMode="text" />
          {passkey ? <PasskeyFactorButton getOptions={reauthPasskeyOptionsAction} /> : null}
        </div>
      ) : null}
      {state && !state.ok ? <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Confirm"}
      </Button>
    </form>
  );
}
