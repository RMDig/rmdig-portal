"use client";

import { startTransition, useActionState, useState } from "react";

import { sendPhoneCodeAction, verifyPhoneCodeAction } from "@/app/(portal)/phone-verify-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Contact-phone block shared by the SAR and advertiser org-creation forms.
// With verification enabled (prod): phone is required, "Text me a code" sends
// the OTP, and "Verify" checks it before the rest of the form is submitted.
// A verified number is locked and its signed proof (lib/phone/proof.ts) goes
// with the form; the server action re-checks that proof, or the code if the
// user submits without verifying, so this UI is convenience, not the gate.
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
  const [code, setCode] = useState("");
  const [sendState, sendCode, sending] = useActionState(sendPhoneCodeAction, null);
  const [checkState, checkCode, checking] = useActionState(verifyPhoneCodeAction, null);
  // "Change number" sets this to the proof being discarded; a later Verify
  // returns a new proof, so the field shows as verified again.
  const [discardedProof, setDiscardedProof] = useState<string | null>(null);
  const verified = checkState?.ok && checkState.proof !== discardedProof ? checkState : null;

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
            readOnly={!!verified}
            aria-invalid={!!fieldErrors?.contactPhone}
          />
          <Button
            type="button"
            variant="outline"
            disabled={sending || !phone.trim() || !!verified}
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
        {verified ? (
          <div className="flex items-center gap-3">
            <input type="hidden" name="phoneProof" value={verified.proof} />
            <p className="text-sm text-green-700 dark:text-green-400">✓ {verified.message}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDiscardedProof(verified.proof);
                setCode("");
              }}
            >
              Change number
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                id="phoneCode"
                name="phoneCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={!!fieldErrors?.phoneCode}
              />
              <Button
                type="button"
                variant="outline"
                disabled={checking || !phone.trim() || !code.trim()}
                onClick={() => {
                  const f = new FormData();
                  f.set("phone", phone);
                  f.set("code", code);
                  startTransition(() => checkCode(f));
                }}
              >
                {checking ? "Checking…" : "Verify"}
              </Button>
            </div>
            {checkState && !checkState.ok ? (
              <p className="text-xs text-red-700 dark:text-red-400">{checkState.error}</p>
            ) : null}
          </>
        )}
        <p className="text-muted-foreground text-xs">
          We verify a phone number for each team — it&apos;s how we reach you
          during review.
        </p>
        <FieldError errors={fieldErrors?.phoneCode} />
      </div>
    </>
  );
}
