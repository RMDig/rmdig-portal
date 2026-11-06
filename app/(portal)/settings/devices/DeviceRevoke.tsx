"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import {
  previewRevokeAction,
  revokeDeviceAction,
  strengthenRevokeAction,
  type PreviewResult,
  type RevokeResult,
} from "./actions";
import { REVOKE_COPY } from "./revoke-copy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const REAUTH_HREF = `/settings/reauth?returnTo=${encodeURIComponent("/settings/devices")}`;

export function Outcome({ state }: { state: RevokeResult | PreviewResult }) {
  if (!state || state.ok) return null;
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

/** What stays true whichever mode a revoke is: said before every confirm. */
export function RevokeFacts({ mode }: { mode: "limited" | "full" }) {
  return (
    <div className="space-y-2 text-sm leading-6">
      <p className="font-medium">{REVOKE_COPY.sendHelpStays}</p>
      <p>{REVOKE_COPY.mode[mode]}</p>
      {mode === "limited" ? <p className="text-muted-foreground">{REVOKE_COPY.limitedWhy}</p> : null}
      <p className="text-muted-foreground">{REVOKE_COPY.whatThePhoneDoes}</p>
      {mode === "full" ? (
        <p className="font-medium text-amber-900 dark:text-amber-200">{REVOKE_COPY.fieldData.full}</p>
      ) : (
        <p className="text-muted-foreground">{REVOKE_COPY.fieldData.limited}</p>
      )}
      <p className="text-muted-foreground">{REVOKE_COPY.limits}</p>
      <p className="text-muted-foreground">{REVOKE_COPY.permanent}</p>
    </div>
  );
}

// "Make this stronger" on a phone already signed out in limited mode (plan 36
// §5.1). Offered only when the user has a passkey old enough to make it full;
// the action still checks that THIS session proved itself with one. The
// confirm repeats the full-mode facts, field-data erase included. Like
// DeviceRevoke it stays mounted on every signed-out phone, so its result
// survives the refresh that turns the row full and withdraws the offer.
export function StrengthenRevoke({ deviceId, offer }: { deviceId: string; offer: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, strengthen, pending] = useActionState<RevokeResult, FormData>(strengthenRevokeAction, null);

  if (result?.ok) {
    return <p className="w-full text-sm text-green-800 dark:text-green-300">{result.message}</p>;
  }
  if (!offer) return null;
  if (!open) {
    return (
      <div className="w-full space-y-1">
        <p className="text-muted-foreground text-sm">{REVOKE_COPY.strengthenOffer}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {REVOKE_COPY.strengthenButton}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-3 w-full space-y-3 rounded-md border p-3">
      <div className="space-y-2 text-sm leading-6">
        <p>{REVOKE_COPY.mode.full}</p>
        <p className="font-medium text-amber-900 dark:text-amber-200">{REVOKE_COPY.fieldData.full}</p>
        <p className="text-muted-foreground">{REVOKE_COPY.limits}</p>
        <p className="text-muted-foreground">{REVOKE_COPY.permanent}</p>
      </div>
      <form action={strengthen} className="flex flex-wrap gap-2">
        <input type="hidden" name="deviceId" value={deviceId} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Saving…" : REVOKE_COPY.strengthenConfirm}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Outcome state={result} />
      </form>
    </div>
  );
}

// One phone's "Sign out this phone": the preview first (every node, behind a
// recent login), its warnings and the mode, then the confirm. It stays mounted
// once the phone is signed out (`revoked`), so the result, including a
// "one server didn't answer" warning, survives the page refreshing under it.
export function DeviceRevoke({ deviceId, revoked }: { deviceId: string; revoked: boolean }) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, startPreview] = useTransition();
  const [result, revoke, revoking] = useActionState<RevokeResult, FormData>(revokeDeviceAction, null);

  if (result?.ok) {
    return <p className="w-full text-sm text-green-800 dark:text-green-300">{result.message}</p>;
  }
  if (revoked) return null;

  if (!preview?.ok) {
    return (
      <div className="space-y-1 text-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => startPreview(async () => setPreview(await previewRevokeAction(deviceId)))}
        >
          {loading ? "Checking…" : "Sign out this phone"}
        </Button>
        <Outcome state={preview} />
      </div>
    );
  }

  const { live } = preview;
  return (
    <div className="mt-3 w-full space-y-3 rounded-md border p-3">
      {live.checkouts > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          {REVOKE_COPY.liveCheckout(preview.dueText)}
        </p>
      ) : null}
      {live.helpRequests > 0 ? <p className="text-sm">{REVOKE_COPY.liveHelp}</p> : null}
      {live.other > 0 ? <p className="text-sm">{REVOKE_COPY.liveOther}</p> : null}
      {preview.incomplete ? (
        <p className="text-muted-foreground text-sm">One server didn&apos;t answer, so this may not list everything.</p>
      ) : null}
      <RevokeFacts mode={preview.mode} />
      <form action={revoke} className="space-y-3">
        <input type="hidden" name="deviceId" value={deviceId} />
        <div className="space-y-1">
          <Label htmlFor={`reason-${deviceId}`}>Why are you signing it out?</Label>
          <select
            id={`reason-${deviceId}`}
            name="reason"
            required
            defaultValue=""
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="" disabled>
              Choose…
            </option>
            <option value="lost">It&apos;s lost</option>
            <option value="stolen">It was stolen</option>
            <option value="user">I don&apos;t use it any more</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={revoking}>
            {revoking ? "Signing out…" : "Sign out this phone"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={revoking}>
            Cancel
          </Button>
        </div>
        <Outcome state={result} />
      </form>
    </div>
  );
}
