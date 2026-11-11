"use client";

import { useActionState, useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ONCALL_COPY } from "@/lib/sar/oncall-email";

import { requestOncallEmailAction } from "./oncall-actions";

// The team's on-call email (plan 33 9.10): the confirmed address, a pending
// one, and a form to propose a new one. Nothing changes until the link sent
// to the new address is confirmed from that inbox.
export function OncallEmailCard({
  orgId,
  current,
  pending,
  termsListEmail,
  editable,
}: {
  orgId: string;
  current: string | null;
  pending: string | null;
  termsListEmail: boolean;
  editable: boolean;
}) {
  const [state, action, busy] = useActionState(requestOncallEmailAction.bind(null, orgId), null);
  const id = useId();
  const fieldError = state && !state.ok ? state.fieldErrors?.address : undefined;
  const shownPending = state?.ok ? state.address : pending;

  return (
    <section className="space-y-3 rounded-md border p-4">
      <h2 className="text-lg font-medium">{ONCALL_COPY.heading}</h2>
      <p className="text-muted-foreground text-sm">{ONCALL_COPY.explain}</p>
      {current ? <p className="text-sm font-medium">{ONCALL_COPY.current(current)}</p> : <p className="text-sm">{ONCALL_COPY.gate}</p>}
      {current && !termsListEmail ? <p className="text-sm">{ONCALL_COPY.termsNote}</p> : null}
      {shownPending ? (
        <p role="status" className="text-sm">
          {state?.ok ? ONCALL_COPY.sent(state.address) : ONCALL_COPY.pending(shownPending)}
          {current ? ` ${ONCALL_COPY.keepsCurrent}` : ""}
        </p>
      ) : null}
      {editable ? (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-address`}>{current ? "New on-call email" : "On-call email"}</Label>
            <Input
              id={`${id}-address`}
              name="address"
              type="email"
              required
              placeholder="dispatch@yourteam.org"
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? `${id}-address-error` : undefined}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Sending…" : "Send confirmation link"}
          </Button>
        </form>
      ) : null}
      {fieldError ? (
        <p id={`${id}-address-error`} className="text-xs text-red-700 dark:text-red-400">
          {fieldError.join(", ")}
        </p>
      ) : null}
      <div aria-live="polite">{state && !state.ok && !fieldError ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}</div>
    </section>
  );
}
