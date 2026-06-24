"use client";

import { useActionState } from "react";

import { AdSlotPreview } from "@/components/advertiser/AdSlotPreview";
import { Button } from "@/components/ui/button";
import { CREATIVE_STATUS_LABEL } from "@/lib/advertiser/creative-status";
import { BUYABLE_SLOTS, SLOT_LABEL, type BuyableSlot } from "@/lib/advertiser/creative-schema";
import { publishApprovedCreativeAction, reviewCreativeAction } from "./actions";

export interface PendingCreative {
  id: string;
  headline: string;
  body: string;
  altText: string;
  clickUrl: string | null;
  slot: string;
  status: string;
  published: boolean;
  advertiserName: string;
  campaignName: string;
  submittedAt: string | null; // ISO
  targetLabel: string; // human-readable target (resolved server-side)
}

export function AdApprovalRow({ creative }: { creative: PendingCreative }) {
  const [state, formAction, pending] = useActionState(reviewCreativeAction, null);
  const publishBound = publishApprovedCreativeAction.bind(null, creative.id);
  const [publishState, publishAction, publishing] = useActionState(publishBound, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const error = state && !state.ok && !fieldErrors ? state.error : undefined;
  const publishError = publishState && !publishState.ok ? publishState.error : undefined;
  const submitted = creative.submittedAt ? new Date(creative.submittedAt) : null;
  const isBuyable = (BUYABLE_SLOTS as readonly string[]).includes(creative.slot);

  return (
    <li className="space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{creative.advertiserName}</h3>
        <span className="text-muted-foreground text-sm">
          {CREATIVE_STATUS_LABEL[creative.status] ?? creative.status}
          {submitted && !Number.isNaN(submitted.getTime())
            ? ` · submitted ${submitted.toLocaleDateString()}`
            : ""}
        </span>
      </div>

      <dl className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-foreground">Campaign: </dt>
          <dd className="inline">{creative.campaignName}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Slot: </dt>
          <dd className="inline">{SLOT_LABEL[creative.slot as BuyableSlot] ?? creative.slot}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Targeting: </dt>
          <dd className="inline">{creative.targetLabel}</dd>
        </div>
        {creative.clickUrl ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-foreground">Tap-through: </dt>
            <dd className="inline">
              <a
                href={creative.clickUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline"
              >
                {creative.clickUrl}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      {isBuyable ? (
        <AdSlotPreview
          slot={creative.slot as BuyableSlot}
          headline={creative.headline}
          body={creative.body}
          clickUrl={creative.clickUrl}
          altText={creative.altText}
        />
      ) : null}

      {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}

      {creative.status === "pending" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* Approve — no note required. */}
          <form action={formAction}>
            <input type="hidden" name="creativeId" value={creative.id} />
            <input type="hidden" name="decision" value="approve" />
            <Button type="submit" disabled={pending}>
              Approve
            </Button>
          </form>

          {/* Reject — reason required. */}
          <form action={formAction} className="flex-1 space-y-2">
            <input type="hidden" name="creativeId" value={creative.id} />
            <input type="hidden" name="decision" value="reject" />
            <textarea
              name="note"
              rows={2}
              placeholder="Reason for rejecting (sent to the advertiser)"
              className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Reject
            </Button>
          </form>

          {/* Request changes — note required; returns to draft for the advertiser. */}
          <form action={formAction} className="flex-1 space-y-2">
            <input type="hidden" name="creativeId" value={creative.id} />
            <input type="hidden" name="decision" value="request_changes" />
            <textarea
              name="note"
              rows={2}
              placeholder="What needs to change (sent to the advertiser)"
              className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Request changes
            </Button>
          </form>
        </div>
      ) : creative.status === "approved" ? (
        <div className="space-y-3">
          {/* Live status — published_at drives this. A failed publish leaves an
              approved creative "not yet live" with a retry, never a false live. */}
          {creative.published ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">● Live in the app</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Approved — not yet live (publish to AvServ didn&apos;t complete).
              </p>
              <form action={publishAction}>
                <Button type="submit" variant="outline" disabled={publishing}>
                  {publishing ? "Publishing…" : "Retry publish"}
                </Button>
              </form>
              {publishError ? (
                <p className="text-sm text-red-700 dark:text-red-400">{publishError}</p>
              ) : null}
            </div>
          )}

          {/* Suspend an approved creative — pulls it from the next manifest. */}
          <form action={formAction} className="max-w-md space-y-2">
            <input type="hidden" name="creativeId" value={creative.id} />
            <input type="hidden" name="decision" value="suspend" />
            <textarea
              name="note"
              rows={2}
              placeholder="Reason for suspending (optional, recorded in the audit log)"
              className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Suspend
            </Button>
          </form>
        </div>
      ) : creative.status === "suspended" ? (
        // Reactivate a suspended creative — returns it to pending for re-review.
        <form action={formAction}>
          <input type="hidden" name="creativeId" value={creative.id} />
          <input type="hidden" name="decision" value="reactivate" />
          <Button type="submit" variant="outline" disabled={pending}>
            Reactivate (re-review)
          </Button>
        </form>
      ) : null}

      {fieldErrors?.note ? (
        <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.note.join(", ")}</p>
      ) : null}
    </li>
  );
}
