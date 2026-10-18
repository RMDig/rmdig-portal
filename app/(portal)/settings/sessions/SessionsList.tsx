"use client";

import Link from "next/link";
import { useActionState } from "react";

import { revokeOtherSessionsAction, revokeSessionAction, type SessionActionResult } from "./actions";
import { Button } from "@/components/ui/button";

export interface SessionRow {
  id: string;
  label: string;
  signedIn: string;
  lastActive: string;
  current: boolean;
}

const REAUTH_HREF = `/settings/reauth?returnTo=${encodeURIComponent("/settings/sessions")}`;

function Result({ state }: { state: SessionActionResult }) {
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

function RevokeOne({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeSessionAction, null);
  return (
    <div className="space-y-1 text-right">
      <form action={action}>
        <input type="hidden" name="sessionId" value={id} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </form>
      <Result state={state} />
    </div>
  );
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const [state, action, pending] = useActionState(revokeOtherSessionsAction, null);
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="space-y-6">
      <ul className="divide-y rounded-md border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="space-y-0.5">
              <p className="font-medium">
                {s.label}
                {s.current ? <span className="text-muted-foreground font-normal"> · this browser</span> : null}
              </p>
              <p className="text-muted-foreground text-sm">
                Signed in {s.signedIn} · last active {s.lastActive}
              </p>
            </div>
            {s.current ? null : <RevokeOne id={s.id} />}
          </li>
        ))}
      </ul>

      {others > 0 ? (
        <div className="space-y-2">
          <form action={action}>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Signing out…" : "Sign out everywhere else"}
            </Button>
          </form>
          <Result state={state} />
        </div>
      ) : null}
    </div>
  );
}
