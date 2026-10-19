"use client";

import { startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import {
  finishPasskeyRegistrationAction,
  passkeyRegistrationOptionsAction,
  removePasskeyAction,
  type PasskeyResult,
} from "./mfa/passkey-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PasskeyRow {
  id: string;
  nickname: string;
  added: string;
  lastUsed: string | null;
}

const REAUTH_HREF = `/settings/reauth?returnTo=${encodeURIComponent("/settings")}`;

function Message({ state }: { state: PasskeyResult }) {
  if (!state) return null;
  if (state.ok) return <p className="text-sm text-green-800 dark:text-green-300">{state.message}</p>;
  return (
    <p className="text-sm text-red-700 dark:text-red-300">
      {state.error}{" "}
      {state.reauth ? (
        <Link href={REAUTH_HREF} className="font-medium underline">
          Confirm it&apos;s you
        </Link>
      ) : null}
    </p>
  );
}

function RemovePasskey({ id }: { id: string }) {
  const [state, action, pending] = useActionState(removePasskeyAction, null);
  return (
    <form action={action} className="space-y-1 text-right">
      <input type="hidden" name="passkeyId" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Removing…" : "Remove"}
      </Button>
      <Message state={state} />
    </form>
  );
}

// Passkeys beside the authenticator code (plan 36 §5.4). Shown only while
// two-factor is on: a passkey is an addition to it, never a replacement.
export function PasskeysCard({ passkeys }: { passkeys: PasskeyRow[] }) {
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<PasskeyResult>(null);
  const [adding, startAdding] = useTransition();

  function add() {
    startAdding(async () => {
      const options = await passkeyRegistrationOptionsAction();
      if (!options.ok) {
        setState(options);
        return;
      }
      try {
        const response = await startRegistration({ optionsJSON: options.options });
        setState(await finishPasskeyRegistrationAction(response, nickname));
        setNickname("");
      } catch (err) {
        const cancelled = err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
        const already = err instanceof Error && err.name === "InvalidStateError";
        setState({
          ok: false,
          error: already
            ? "This device already has a passkey for your account."
            : cancelled
              ? "The passkey prompt was cancelled or timed out."
              : "This device couldn't create a passkey.",
        });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>
          Use your phone, laptop or security key instead of typing your authenticator code. A
          passkey that has been on your account for 7 days also lets you fully sign out a lost
          phone. Keep your recovery codes: they still work if you lose every passkey.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {passkeys.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="space-y-0.5">
                  <p className="font-medium">{p.nickname}</p>
                  <p className="text-muted-foreground text-sm">
                    Added {p.added}
                    {p.lastUsed ? ` · last used ${p.lastUsed}` : " · not used yet"}
                  </p>
                </div>
                <RemovePasskey id={p.id} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="passkey-name">Name for a new passkey</Label>
          <Input
            id="passkey-name"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="My iPhone"
            maxLength={60}
          />
          <Button type="button" onClick={add} disabled={adding || nickname.trim() === ""}>
            {adding ? "Waiting for your device…" : "Add a passkey"}
          </Button>
          <Message state={state} />
        </div>
      </CardContent>
    </Card>
  );
}
