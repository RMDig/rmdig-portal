"use client";

import { useActionState } from "react";

import RegionPreviewMap, { type PreviewPolygon } from "@/components/map/RegionPreviewMap";
import { Button } from "@/components/ui/button";
import { resyncSarOrgAction, reviewSarOrgAction } from "./actions";
import { formatMountain, formatMountainDate } from "@/lib/format/time";

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

const STATUS_BADGE: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  leaving: "Leaving the program",
  suspended: "Suspended",
};

export interface NodeSync {
  node: string;
  revision: number;
  outcome: string;
  detail: string;
  syncedAt: string | null;
}

export interface PendingOrg {
  id: string;
  name: string;
  status: string;
  orgType: "sar_team" | "ski_patrol";
  submitterEmail: string;
  submittedAt: string; // ISO
  operatingStatus: string;
  operatingStatusOther: string | null;
  regionName: string | null;
  region: PreviewPolygon | null;
  reverifyBy: string | null;
  sync: NodeSync[];
}

// One small form per lifecycle action (approved/leaving/suspended orgs).
function ActionButton({
  formAction,
  orgId,
  decision,
  label,
  pending,
  note,
  noteRequired = false,
}: {
  formAction: (fd: FormData) => void;
  orgId: string;
  decision: string;
  label: string;
  pending: boolean;
  note?: string;
  noteRequired?: boolean;
}) {
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="decision" value={decision} />
      {note ? (
        <textarea
          name="note"
          rows={2}
          required={noteRequired}
          placeholder={note}
          className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
        />
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function SarApprovalRow({ org }: { org: PendingOrg }) {
  const [state, formAction, pending] = useActionState(reviewSarOrgAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const error = state && !state.ok && !fieldErrors ? state.error : undefined;
  const submitted = new Date(org.submittedAt);

  return (
    <li id={`org-${org.id}`} className="scroll-mt-20 space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{org.name}</h3>
        <span className="text-muted-foreground text-sm">
          {STATUS_BADGE[org.status] ?? org.status} · submitted{" "}
          {Number.isNaN(submitted.getTime()) ? "" : formatMountainDate(submitted)}
        </span>
      </div>

      <dl className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-foreground">Submitter: </dt>
          <dd className="inline">{org.submitterEmail}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Kind: </dt>
          <dd className="inline">{org.orgType === "ski_patrol" ? "Ski-area patrol" : "Search & rescue team"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Operating status: </dt>
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
              href={`/admin/sar-approvals/proof/${org.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              View document
            </a>
          </dd>
        </div>
      </dl>

      {org.orgType === "ski_patrol" && org.status === "pending" ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Ski patrol: before approving, call the ski area on a phone number you find yourself (its
          website or directory listing), not one from this application, and confirm the patrol and
          its contact (runbook &quot;Review a SAR org application&quot;).
        </p>
      ) : null}

      <RegionPreviewMap polygon={org.region} />

      {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}

      {org.status === "pending" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* Approve — staff-only note, required for a patrol (the call-back). */}
          <form action={formAction} className="flex-1 space-y-2">
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="decision" value="approve" />
            <textarea
              name="note"
              rows={2}
              required={org.orgType === "ski_patrol"}
              placeholder={
                org.orgType === "ski_patrol"
                  ? "Who you spoke to at the ski area, and the number you called (staff only)"
                  : "Note (optional, staff only)"
              }
              className="border-input flex w-full rounded-md border px-3 py-2 text-sm"
            />
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
      ) : (
        // Lifecycle of an approved org. Suspension for cause is immediate in
        // AvServ; leaving keeps bound check-outs until they end; withdraw only
        // once no node has open check-outs bound (checked by the action).
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          {org.status === "approved" || org.status === "leaving" ? (
            <ActionButton
              formAction={formAction}
              orgId={org.id}
              decision="suspend"
              label="Suspend (stops alerts at once)"
              pending={pending}
              note="Reason for suspending (optional, recorded in the audit log)"
            />
          ) : null}
          {org.status === "approved" ? (
            <ActionButton formAction={formAction} orgId={org.id} decision="mark_leaving" label="Mark leaving" pending={pending} />
          ) : null}
          {org.status === "approved" && org.orgType === "ski_patrol" ? (
            <ActionButton
              formAction={formAction}
              orgId={org.id}
              decision="reverify"
              label="Mark re-verified (12 months)"
              pending={pending}
              note="Who you spoke to at the ski area, and the number you called (required)"
              noteRequired
            />
          ) : null}
          {org.status === "leaving" || org.status === "suspended" ? (
            <ActionButton formAction={formAction} orgId={org.id} decision="withdraw" label="Withdraw" pending={pending} />
          ) : null}
          {org.status === "suspended" ? (
            <ActionButton formAction={formAction} orgId={org.id} decision="reactivate" label="Reactivate (re-review)" pending={pending} />
          ) : null}
        </div>
      )}

      {org.status !== "pending" ? (
        <div className="space-y-1 text-sm">
          {org.orgType === "ski_patrol" && org.reverifyBy ? (
            <p className="text-muted-foreground">Re-verify by {formatMountainDate(new Date(org.reverifyBy))}.</p>
          ) : null}
          <p className="font-medium">AvServ sync</p>
          {org.sync.length === 0 ? (
            <p className="text-muted-foreground">Not sent yet.</p>
          ) : (
            <ul className="text-muted-foreground">
              {org.sync.map((s) => (
                <li key={s.node} className={s.outcome === "error" ? "text-red-700 dark:text-red-400" : undefined}>
                  {s.node}: revision {s.revision}, {s.detail}
                  {s.syncedAt ? ` · last accepted ${formatMountain(new Date(s.syncedAt))}` : ""}
                </li>
              ))}
            </ul>
          )}
          <form action={resyncSarOrgAction}>
            <input type="hidden" name="orgId" value={org.id} />
            <Button type="submit" variant="ghost" size="sm">
              Resync to AvServ
            </Button>
          </form>
        </div>
      ) : null}

      {fieldErrors?.note ? (
        <p className="text-xs text-red-700 dark:text-red-400">{fieldErrors.note.join(", ")}</p>
      ) : null}
    </li>
  );
}
