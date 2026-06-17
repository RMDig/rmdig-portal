"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdvertiserInvitationAction } from "./actions";

// Role options. Values mirror the advertiser_role enum; default to editor (least
// privilege). Inlined to keep this client component free of the server db import.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

export function InviteForm({ advertiserId }: { advertiserId: string }) {
  const action = createAdvertiserInvitationAction.bind(null, advertiserId);
  const [state, formAction, pending] = useActionState(action, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <section className="space-y-4 rounded-md border p-4">
      <h2 className="text-lg font-medium">Invite a teammate</h2>
      <form action={formAction} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required aria-invalid={!!fieldErrors?.email} />
          {fieldErrors?.email ? (
            <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.email.join(", ")}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            defaultValue="editor"
            className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {state && !state.ok && !fieldErrors ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </form>

      {state?.ok ? (
        <div className="bg-muted space-y-1 rounded-md border px-4 py-3 text-sm">
          <p>
            Invitation sent to <strong>{state.email}</strong>. Share this link if they don&apos;t
            get the email:
          </p>
          <code className="block break-all">{state.inviteUrl}</code>
        </div>
      ) : null}
    </section>
  );
}
