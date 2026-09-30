"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { saveAvaiIdentityAction } from "./avai-account-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Legal name + the name on alert texts (AvServ `displayName`). React 19 resets
// uncontrolled fields after every action, so what the user entered is captured
// on submit and restored through defaultValue (never controlled inputs — see
// app/(auth)/sign-in/SignInForm.tsx).
export function AvaiIdentityForm({
  legalName,
  displayName,
}: {
  legalName: string;
  displayName: string;
}) {
  const [state, formAction, pending] = useActionState(saveAvaiIdentityAction, null);
  const [entered, setEntered] = useState({ legalName, displayName });
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        setEntered({
          legalName: String(fd.get("legalName") ?? ""),
          displayName: String(fd.get("displayName") ?? ""),
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="avai-legalName">Legal name</Label>
        <Input
          id="avai-legalName"
          name="legalName"
          defaultValue={entered.legalName}
          maxLength={200}
          autoComplete="name"
          aria-invalid={!!fieldErrors?.legalName}
        />
        <p className="text-muted-foreground text-xs">
          The name the AvAI user agreement is signed under. Changing it asks you to accept the
          agreement again.
        </p>
        <FieldError messages={fieldErrors?.legalName} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="avai-displayName">Name on your alerts</Label>
        <Input
          id="avai-displayName"
          name="displayName"
          defaultValue={entered.displayName}
          maxLength={80}
          aria-invalid={!!fieldErrors?.displayName}
        />
        <p className="text-muted-foreground text-xs">
          Shown to your emergency contacts in alert texts. Letters, spaces, hyphens and apostrophes
          only.
        </p>
        <FieldError messages={fieldErrors?.displayName} />
      </div>
      {state?.ok ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          Saved.
          {state.needsAcceptance ? (
            <>
              {" "}
              Please{" "}
              <Link href="/settings/agreement" className="underline">
                review and accept the agreement
              </Link>{" "}
              under this name.
            </>
          ) : null}
        </p>
      ) : null}
      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save names"}
      </Button>
    </form>
  );
}

function FieldError({ messages }: { messages: string[] | undefined }) {
  return messages ? (
    <p className="text-xs text-red-700 dark:text-red-400">{messages.join(", ")}</p>
  ) : null;
}
