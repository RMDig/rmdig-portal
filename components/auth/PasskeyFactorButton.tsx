"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { startAuthentication } from "@simplewebauthn/browser";
import { useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";

export type PasskeyOptionsResult = { ok: true; options: PublicKeyCredentialRequestOptionsJSON } | { ok: false; error: string };

// "Use a passkey" inside a form that already carries the password: fetches
// options, runs the browser's passkey prompt, puts the answer in a hidden
// field and submits the form, so the server checks password and passkey in
// one request. The form's own fields stay uncontrolled (password-manager
// autofill, reference_react19_form_reset_autofill).
export function PasskeyFactorButton({
  getOptions,
  name = "passkey",
}: {
  getOptions: () => Promise<PasskeyOptionsResult>;
  name?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getOptions();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const answer = await startAuthentication({ optionsJSON: r.options });
      const field = form.elements.namedItem(name);
      if (!(field instanceof HTMLInputElement)) throw new Error("passkey field missing from the form");
      field.value = JSON.stringify(answer);
      form.requestSubmit();
    } catch (err) {
      // The person cancelled, the prompt timed out, or this device can't use a
      // passkey here: say which, so they can fall back to their code.
      const cancelled = err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
      setError(cancelled ? "The passkey prompt was cancelled or timed out." : "This device couldn't use a passkey here. Use your code instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <input type="hidden" name={name} defaultValue="" />
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={run}>
        {busy ? "Waiting for your passkey…" : "Use a passkey instead"}
      </Button>
      {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
