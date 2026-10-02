"use client";

import { startTransition, useActionState, useState } from "react";

import { sendPhoneCodeAction } from "@/app/(portal)/phone-verify-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Contact-phone block shared by the SAR and advertiser org-creation forms.
// With verification enabled (prod): phone is required, a "Text me a code"
// button sends the OTP, and the code field must be filled — the server action
// re-checks the code against Twilio, so this UI is convenience, not the gate.
// Disabled (CI/local/preview): renders the plain optional phone input.

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700 dark:text-red-400">{errors.join(", ")}</p>;
}

export function VerifiedPhoneField({
  enabled,
  fieldErrors,
}: {
  enabled: boolean;
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  // Controlled is fine here (not a credential field — no password-manager
  // autofill concerns): the send-code button needs the current value, and
  // client state survives a failed server-action round trip.
  const [phone, setPhone] = useState("");
  const [sendState, sendCode, sending] = useActionState(sendPhoneCodeAction, null);

  if (!enabled) {
    return (
      <div className="space-y-2">
        <Label htmlFor="contactPhone">Contact phone (optional)</Label>
        <Input
          id="contactPhone"
          name="contactPhone"
          type="tel"
          aria-invalid={!!fieldErrors?.contactPhone}
        />
        <FieldError errors={fieldErrors?.contactPhone} />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="contactPhone">Contact phone (US)</Label>
        <div className="flex gap-2">
          <Input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={!!fieldErrors?.contactPhone}
          />
          <Button
            type="button"
            variant="outline"
            disabled={sending || !phone.trim()}
            onClick={() => {
              const f = new FormData();
              f.set("phone", phone);
              startTransition(() => sendCode(f));
            }}
          >
            {sending ? "Sending…" : "Text me a code"}
          </Button>
        </div>
        {sendState ? (
          <p
            className={
              sendState.ok
                ? "text-xs text-green-700 dark:text-green-400"
                : "text-xs text-red-700 dark:text-red-400"
            }
          >
            {sendState.ok ? sendState.message : sendState.error}
          </p>
        ) : null}
        <FieldError errors={fieldErrors?.contactPhone} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phoneCode">Verification code</Label>
        <Input
          id="phoneCode"
          name="phoneCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          aria-invalid={!!fieldErrors?.phoneCode}
        />
        <p className="text-muted-foreground text-xs">
          We verify a phone number for each organization — it&apos;s how we reach you
          during review.
        </p>
        <FieldError errors={fieldErrors?.phoneCode} />
      </div>
    </>
  );
}
