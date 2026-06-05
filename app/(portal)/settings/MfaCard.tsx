"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { disableMfaAction, regenerateRecoveryCodesAction } from "./mfa/actions";
import { RecoveryCodes } from "./mfa/RecoveryCodes";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaCard({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add a second step at sign-in with an authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/mfa/enroll">Set up two-factor</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <ManageMfa />;
}

function ManageMfa() {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "disable" | "regenerate">("idle");

  const [disableState, disableAction, disabling] = useActionState(disableMfaAction, null);
  const [regenState, regenAction, regenerating] = useActionState(
    regenerateRecoveryCodesAction,
    null,
  );

  // Reflect a successful disable immediately (card flips to the "off" state).
  useEffect(() => {
    if (disableState?.ok) router.refresh();
  }, [disableState, router]);

  const newCodes = regenState?.ok && "recoveryCodes" in regenState ? regenState.recoveryCodes : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Two-factor authentication is on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {newCodes ? <RecoveryCodes codes={newCodes} /> : null}

        {mode === "idle" ? (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setMode("regenerate")}>
              Regenerate recovery codes
            </Button>
            <Button variant="outline" onClick={() => setMode("disable")}>
              Disable
            </Button>
          </div>
        ) : null}

        {mode === "regenerate" && !newCodes ? (
          <form action={regenAction} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="regen-code">
                Enter a current authenticator or recovery code to generate a new set
              </Label>
              <Input
                id="regen-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </div>
            {regenState && !regenState.ok ? (
              <p className="text-sm text-red-700 dark:text-red-400">{regenState.error}</p>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit" disabled={regenerating}>
                {regenerating ? "Generating…" : "Generate new codes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "disable" ? (
          <form action={disableAction} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="disable-code">
                Enter a current authenticator or recovery code to turn off two-factor
              </Label>
              <Input
                id="disable-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </div>
            {disableState && !disableState.ok ? (
              <p className="text-sm text-red-700 dark:text-red-400">{disableState.error}</p>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit" variant="destructive" disabled={disabling}>
                {disabling ? "Disabling…" : "Disable two-factor"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
