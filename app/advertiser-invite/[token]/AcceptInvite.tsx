"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { acceptAdvertiserInvitationAction } from "./actions";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  // Bind the token (the bearer credential, already in the URL) to the action.
  const action = acceptAdvertiserInvitationAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.ok) router.push(`/advertiser/${state.advertiserId}/creatives`);
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
      {state && !state.ok ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}
    </form>
  );
}
