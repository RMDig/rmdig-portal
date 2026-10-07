"use client";

import { useActionState } from "react";

import {
  cancelPlatformInviteAction,
  createPlatformInviteAction,
  revokePlatformRoleAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useSubmittedValues } from "@/components/forms/use-submitted-values";

export function InviteStaffForm() {
  const [state, formAction, pending] = useActionState(createPlatformInviteAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  // A rejected invite keeps the address and role (never the password); a
  // sent one clears for the next.
  const { values, capture } = useSubmittedValues({ email: "", role: "rmdig_reviewer" });
  const kept = state?.ok ? { email: "", role: "rmdig_reviewer" } : values;

  return (
    <form action={formAction} onSubmit={capture} className="space-y-4">
      {state?.ok ? (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
          Invitation sent.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            defaultValue={kept.email}
            aria-invalid={!!fieldErrors?.email}
          />
          {fieldErrors?.email ? (
            <p className="text-xs text-red-700 dark:text-red-400">
              {fieldErrors.email.join(", ")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue={kept.role}
            className="border-input bg-transparent dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring md:text-sm"
          >
            <option value="rmdig_reviewer">Reviewer — approval queues only</option>
            <option value="rmdig_admin">Platform Administrator — full operator</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-password">Your password</Label>
        <PasswordInput
          id="invite-password"
          name="currentPassword"
          autoComplete="current-password"
          required
          aria-invalid={!!fieldErrors?.currentPassword}
        />
        <p className="text-muted-foreground text-xs">
          Granting staff access requires confirming your password.
        </p>
      </div>
      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}

export function CancelInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState(cancelPlatformInviteAction, null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel"}
      </Button>
      {state && !state.ok ? (
        <span className="text-xs text-red-700 dark:text-red-400">{state.error}</span>
      ) : null}
    </form>
  );
}

export function RevokeRoleForm({
  targetUserId,
  role,
}: {
  targetUserId: string;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(revokePlatformRoleAction, null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="targetUserId" value={targetUserId} />
      <input type="hidden" name="role" value={role} />
      <PasswordInput
        name="currentPassword"
        autoComplete="current-password"
        required
        placeholder="Your password"
        className="h-8 w-44 text-sm"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state && !state.ok ? (
        <span className="text-xs text-red-700 dark:text-red-400">{state.error}</span>
      ) : null}
    </form>
  );
}
