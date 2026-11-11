"use client";

import { useActionState, useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createDrillLoginAction } from "./actions";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "responder", label: "Responder" },
] as const;

const selectClass = "border-input bg-transparent flex h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

// Add a drill login to one drill team (plan 37 §4.2). The address must be a
// drill address; the server checks it again, and so does the database.
export function DrillLoginForm({ orgId }: { orgId: string }) {
  const [state, formAction, pending] = useActionState(createDrillLoginAction.bind(null, orgId), null);
  const id = useId();
  const emailError = state && !state.ok ? state.fieldErrors?.email : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-email`}>Drill address</Label>
          <Input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            placeholder="name+drill1@rmdig.ai"
            aria-invalid={!!emailError}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-role`}>Role</Label>
          <select id={`${id}-role`} name="role" defaultValue="admin" className={selectClass}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add drill login"}
        </Button>
      </div>
      {emailError ? (
        <p id={`${id}-email-error`} className="text-xs text-red-700 dark:text-red-400">
          {emailError.join(", ")}
        </p>
      ) : null}
      <div aria-live="polite">
        {state && !state.ok && !emailError ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
        {state?.ok ? (
          <p className="text-sm">
            {state.emailed
              ? `Added ${state.email}. A link to set its password is on its way (valid 60 minutes).`
              : `Added ${state.email}, but the email didn't send. Use "Forgot password" with that address to get a link.`}
          </p>
        ) : null}
      </div>
    </form>
  );
}
