"use client";

import { useActionState } from "react";

import { mintDeviceLinkCodeAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMountain } from "@/lib/format/time";

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return formatMountain(date);
}

export function LinkDeviceCard() {
  const [state, formAction, pending] = useActionState(mintDeviceLinkCodeAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link a device</CardTitle>
        <CardDescription>
          Generate a one-time code, then enter it in the AvAI app on your device to link it to
          your account. The code expires in 10 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state?.ok ? (
          <div className="space-y-2">
            <div className="rounded-md border bg-muted px-4 py-3 text-center">
              <span className="font-mono text-2xl tracking-widest tabular-nums">
                {state.code}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              Enter this code in the AvAI app before {formatExpiry(state.expiresAt)}. Generate a new
              one if it expires.
            </p>
          </div>
        ) : null}

        {state && !state.ok ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
            {state.error}
          </div>
        ) : null}

        <form action={formAction}>
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : state?.ok ? "Generate a new code" : "Generate link code"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
