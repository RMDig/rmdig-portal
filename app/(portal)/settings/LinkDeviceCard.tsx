"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { mintDeviceLinkCodeAction } from "./actions";
import { codeStillLive, LINK_POLL_MS, newlyLinked, type DeviceSummary } from "./link-watch";
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

// `devices` is the page's current list (null when it couldn't load). While a
// code is showing, the card re-renders the page every few seconds so a phone
// that redeems the code appears without a manual reload, then stops and says so.
export function LinkDeviceCard({ devices }: { devices: DeviceSummary[] | null }) {
  const [state, formAction, pending] = useActionState(mintDeviceLinkCodeAction, null);
  const router = useRouter();
  // The device ids present when the current code was requested.
  const [baseline, setBaseline] = useState<string[] | null>(null);

  const linked = state?.ok ? newlyLinked(baseline, devices) : null;
  const expiresAt = state?.ok ? state.expiresAt : null;
  const watching = expiresAt !== null && linked === null;

  useEffect(() => {
    if (!watching || expiresAt === null) return;
    const tick = () => {
      // A hidden tab doesn't poll; it catches up the moment it's shown again.
      if (document.visibilityState === "visible" && codeStillLive(expiresAt, Date.now())) {
        router.refresh();
      }
    };
    const timer = window.setInterval(tick, LINK_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [watching, expiresAt, router]);

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
        {linked ? (
          <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
            Your {linked.platform} device is linked. It&apos;s in the list above.
          </div>
        ) : state?.ok ? (
          <div className="space-y-2">
            <div className="rounded-md border bg-muted px-4 py-3 text-center">
              <span className="font-mono text-2xl tracking-widest tabular-nums">
                {state.code}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              Enter this code in the AvAI app before {formatExpiry(state.expiresAt)}. This page
              updates on its own once your device is linked. Generate a new code if it expires.
            </p>
          </div>
        ) : null}

        {state && !state.ok ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
            {state.error}
          </div>
        ) : null}

        <form
          action={formAction}
          onSubmit={() => setBaseline(devices ? devices.map((d) => d.deviceId) : null)}
        >
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : state?.ok ? "Generate a new code" : "Generate link code"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
