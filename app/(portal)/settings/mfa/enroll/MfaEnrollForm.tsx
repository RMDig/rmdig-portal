"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useActionState } from "react";

import { confirmMfaEnrollmentAction } from "../actions";
import { RecoveryCodes } from "../RecoveryCodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaEnrollForm({
  qrDataUrl,
  secret,
}: {
  qrDataUrl: string;
  secret: string;
}) {
  const [state, formAction, pending] = useActionState(confirmMfaEnrollmentAction, null);

  // Success: MFA is on. Show the one-time recovery codes and stop here.
  if (state?.ok && "recoveryCodes" in state) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-green-700 dark:text-green-400">
          Two-factor authentication is on.
        </p>
        <RecoveryCodes codes={state.recoveryCodes} />
        <Link href="/settings" className="text-foreground text-sm font-medium underline">
          Done — back to settings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
        <li>Scan this QR code with an authenticator app (Google Authenticator, 1Password, etc.).</li>
        <li>Enter the 6-digit code it shows to confirm.</li>
      </ol>

      <div className="flex flex-col items-center gap-3">
        {/* qrDataUrl is a data: URI generated server-side from the otpauth link */}
        <img
          src={qrDataUrl}
          alt="Two-factor QR code"
          width={192}
          height={192}
          className="rounded-md border"
        />
        <p className="text-muted-foreground text-center text-xs">
          Can&apos;t scan? Enter this key manually:
          <br />
          <span className="font-mono break-all">{secret}</span>
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
            required
          />
        </div>
        {state && !state.ok ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify and enable"}
        </Button>
      </form>
    </div>
  );
}
