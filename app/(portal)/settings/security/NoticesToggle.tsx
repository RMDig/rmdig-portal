"use client";

import Link from "next/link";
import { useActionState } from "react";

import { setNoticesAction, type NoticesResult } from "./actions";
import { Button } from "@/components/ui/button";

const REAUTH_HREF = `/settings/reauth?returnTo=${encodeURIComponent("/settings/security")}`;

export function NoticesToggle({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<NoticesResult, FormData>(setNoticesAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : on ? "Turn notices off" : "Turn notices on"}
      </Button>
      {state?.ok ? <p className="text-sm text-green-800 dark:text-green-300">{state.message}</p> : null}
      {state && !state.ok ? (
        <p className="text-sm text-red-700 dark:text-red-300">
          {state.error}{" "}
          {state.reauth ? (
            <Link href={REAUTH_HREF} className="font-medium underline">
              Confirm it&apos;s you
            </Link>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
