"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { acceptAgreementAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The accept form under the agreement text. Agree stays disabled until the end
// of the text has scrolled into view (plan 31 D2): that is what makes the
// `presentedInFull: true` we send AvServ honest. The idempotency key and the
// display time come from the server render as hidden defaultValues, so a retry
// click after a transient failure resends the same acceptance. React 19 resets
// uncontrolled fields after every action; what the user entered is captured on
// submit and restored through defaultValue/defaultChecked (never controlled
// inputs — see app/(auth)/sign-in/SignInForm.tsx).

interface Attestation {
  id: string;
  label: string;
  required: boolean;
}

export function AgreementForm({
  version,
  assentText,
  attestations,
  idempotencyKey,
  displayedAt,
  legalName,
  displayName,
  showForm,
  children,
}: {
  version: string;
  assentText: string;
  attestations: Attestation[];
  idempotencyKey: string;
  displayedAt: string;
  legalName: string;
  displayName: string;
  showForm: boolean;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(acceptAgreementAction, null);
  const [readToEnd, setReadToEnd] = useState(false);
  const [entered, setEntered] = useState<{ legalName: string; displayName: string; checked: Set<string> }>({
    legalName,
    displayName,
    checked: new Set(),
  });
  const endRef = useRef<HTMLDivElement>(null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    const el = endRef.current;
    if (!el || readToEnd) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setReadToEnd(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [readToEnd]);

  if (state?.ok) {
    return (
      <>
        <article className="rounded-md border p-6">{children}</article>
        <p className="rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
          Agreement accepted.{state.activated ? " Your AvAI account is set up." : ""}{" "}
          <Link href="/settings" className="underline">
            Back to settings
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <article className="rounded-md border p-6">
        {children}
        <div ref={endRef} aria-hidden="true" className="h-px" />
      </article>

      {showForm ? (
        <form
          action={formAction}
          onSubmit={(e) => {
            const fd = new FormData(e.currentTarget);
            setEntered({
              legalName: String(fd.get("legalName") ?? ""),
              displayName: String(fd.get("displayName") ?? ""),
              checked: new Set([...fd.keys()].filter((k) => fd.get(k) === "on")),
            });
          }}
          className="space-y-5"
        >
          <input type="hidden" name="idempotencyKey" defaultValue={idempotencyKey} />
          <input type="hidden" name="version" defaultValue={version} />
          <input type="hidden" name="displayedAt" defaultValue={displayedAt} />
          <input type="hidden" name="presentedInFull" value={readToEnd ? "true" : "false"} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agreement-legalName">Legal name</Label>
              <Input
                id="agreement-legalName"
                name="legalName"
                defaultValue={entered.legalName}
                maxLength={200}
                autoComplete="name"
                required
                aria-invalid={!!fieldErrors?.legalName}
              />
              <FieldError messages={fieldErrors?.legalName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agreement-displayName">Name on your alerts</Label>
              <Input
                id="agreement-displayName"
                name="displayName"
                defaultValue={entered.displayName}
                maxLength={80}
                required
                aria-invalid={!!fieldErrors?.displayName}
              />
              <FieldError messages={fieldErrors?.displayName} />
            </div>
          </div>

          {attestations.map((a) => (
            <div key={a.id} className="space-y-1">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name={`attestation.${a.id}`}
                  defaultChecked={entered.checked.has(`attestation.${a.id}`)}
                  required={a.required}
                  className="mt-1 size-4"
                />
                {/* Rendered exactly as AvServ publishes it; its hash is sent back. */}
                <span>{a.label}</span>
              </label>
              <FieldError messages={fieldErrors?.[`attestation.${a.id}`]} />
            </div>
          ))}

          <div className="space-y-1">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="assent"
                defaultChecked={entered.checked.has("assent")}
                required
                className="mt-1 size-4"
              />
              <span className="font-medium">{assentText}</span>
            </label>
            <FieldError messages={fieldErrors?.assent} />
          </div>

          {state && !state.ok ? (
            <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
          ) : null}
          {!readToEnd ? (
            <p className="text-muted-foreground text-sm">Scroll to the end of the agreement to continue.</p>
          ) : null}
          <Button type="submit" disabled={!readToEnd || pending}>
            {pending ? "Recording…" : "I agree"}
          </Button>
        </form>
      ) : null}
    </>
  );
}

function FieldError({ messages }: { messages: string[] | undefined }) {
  return messages ? (
    <p className="text-xs text-red-700 dark:text-red-400">{messages.join(", ")}</p>
  ) : null;
}
