"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction } from "./manage-actions";

// Per-row controls on the members page. Each row keeps its own action state
// and stays mounted across revalidation, so its message survives the refresh.
const ROLE_OPTIONS = [
  { value: "responder", label: "Responder" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "admin", label: "Admin" },
] as const;

function Message({ state }: { state: { ok: boolean; message?: string; error?: string } | null }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-xs text-green-700 dark:text-green-400">{state.message}</p>
  ) : (
    <p className="text-xs text-red-700 dark:text-red-400">{state.error}</p>
  );
}

export function MemberControls({
  orgId,
  userId,
  role,
  isYou,
  label,
}: {
  orgId: string;
  userId: string;
  role: string;
  isYou: boolean;
  label: string;
}) {
  const [roleState, roleAction, rolePending] = useActionState(changeMemberRoleAction.bind(null, orgId), null);
  const [removeState, removeAction, removePending] = useActionState(removeMemberAction.bind(null, orgId), null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <label className="sr-only" htmlFor={`role-${userId}`}>
            Role for {label}
          </label>
          <select
            id={`role-${userId}`}
            name="role"
            defaultValue={role}
            className="border-input bg-transparent h-8 rounded-md border px-2 text-sm"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={rolePending}>
            Save
          </Button>
        </form>
        {confirming ? (
          <form action={removeAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" size="sm" variant="destructive" disabled={removePending}>
              {isYou ? "Confirm: leave" : "Confirm: remove"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            {isYou ? "Leave" : "Remove"}
          </Button>
        )}
      </div>
      <Message state={roleState} />
      <Message state={removeState} />
    </div>
  );
}

export function RevokeInvite({ orgId, invitationId }: { orgId: string; invitationId: string }) {
  const [state, action, pending] = useActionState(revokeInvitationAction.bind(null, orgId), null);
  return (
    <div className="space-y-1 text-right">
      <form action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Revoke
        </Button>
      </form>
      <Message state={state} />
    </div>
  );
}
