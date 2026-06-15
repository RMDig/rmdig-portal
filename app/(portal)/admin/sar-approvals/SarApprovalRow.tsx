"use client";

import { useActionState } from "react";

import RegionPreviewMap, { type PreviewPolygon } from "@/components/map/RegionPreviewMap";
import { Button } from "@/components/ui/button";
import { reviewSarOrgAction } from "./actions";

// Operating-status labels (value mirrors the operating_status enum). Inlined to
// keep this client component free of the server-only db import.
const OPERATING_STATUS_LABEL: Record<string, string> = {
  county_sar: "County search & rescue",
  state_sar: "State search & rescue",
  "501c3": "501(c)(3) nonprofit",
  nonprofit: "Other nonprofit",
  volunteer_group: "Volunteer group",
  other: "Other",
};

export interface PendingOrg {
  id: string;
  name: string;
  submitterEmail: string;
  submittedAt: string; // ISO
  operatingStatus: string;
  operatingStatusOther: string | null;
  regionName: string | null;
  proofDocUrl: string;
  region: PreviewPolygon | null;
}

export function SarApprovalRow({ org }: { org: PendingOrg }) {
  const [state, formAction, pending] = useActionState(reviewSarOrgAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const error = state && !state.ok && !fieldErrors ? state.error : undefined;
  const submitted = new Date(org.submittedAt);

  return (
    <li className="space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{org.name}</h3>
        <span className="text-muted-foreground text-sm">
          Submitted {Number.isNaN(submitted.getTime()) ? "" : submitted.toLocaleDateString()}
        </span>
      </div>

      <dl className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-foreground">Submitter: </dt>
          <dd className="inline">{org.submitterEmail}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Type: </dt>
          <dd className="inline">
            {OPERATING_STATUS_LABEL[org.operatingStatus] ?? org.operatingStatus}
            {org.operatingStatus === "other" && org.operatingStatusOther
              ? ` — ${org.operatingStatusOther}`
              : ""}
          </dd>
        </div>
        {org.regionName ? (
          <div>
            <dt className="inline font-medium text-foreground">Region: </dt>
            <dd className="inline">{org.regionName}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline font-medium text-foreground">Proof: </dt>
          <dd className="inline">
            <a
              href={org.proofDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              View document
            </a>
          </dd>
        </div>
      </dl>

      <RegionPreviewMap polygon={org.region} />

      {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {/* Approve — no note required. */}
        <form action={formAction}>
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="decision" value="approve" />
          <Button type="submit" disabled={pending}>
            Approve
          </Button>
        </form>

        {/* Reject — reason required. */}
        <form action={formAction} className="flex-1 space-y-2">
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="decision" value="reject" />
          <textarea
            name="note"
            rows={2}
            placeholder="Reason for rejecting (sent to the submitter)"
            className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Reject
          </Button>
        </form>

        {/* Request changes — note required; org stays pending. */}
        <form action={formAction} className="flex-1 space-y-2">
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="decision" value="request_changes" />
          <textarea
            name="note"
            rows={2}
            placeholder="What needs to change (sent to the submitter)"
            className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Request changes
          </Button>
        </form>
      </div>
      {fieldErrors?.note ? (
        <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.note.join(", ")}</p>
      ) : null}
    </li>
  );
}
