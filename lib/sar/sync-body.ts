import type { SarCapabilitySetting } from "../db/schema";

// The team-sync PUT body (AvServ sar_team_sync.md §1), built from the portal's
// own records. Pure, so every rule is unit-tested. The portal is the only
// place a team is approved; this only ever reports the portal's decision.

export type SyncStatus = "approved" | "leaving" | "suspended" | "withdrawn";

export interface SyncOrg {
  id: string;
  name: string;
  orgType: "sar_team" | "ski_patrol";
  status: "pending" | "approved" | "rejected" | "suspended" | "leaving" | "withdrawn";
  approvedAt: Date | null;
  approvedByUserId: string | null;
  verifiedAt: Date | null;
  reverifyBy: Date | null;
  leavingNoticeAt: Date | null;
}

export interface SyncTerms {
  version: number;
  sha256: string;
  publishedAt: Date;
  body: string;
  requiresReacceptance: boolean;
  capabilities: SarCapabilitySetting[];
}

export interface SyncBody {
  orgId: string;
  revision: number;
  status: SyncStatus;
  leavingNoticeAt: string | null;
  orgType: "sar" | "patrol";
  displayName: string;
  approvedAt: string | null;
  approvedBy: string | null;
  verifiedAt: string | null;
  reverifyBy: string | null;
  serviceArea: { type: "Polygon"; coordinates: number[][][] };
  channels: Array<{ kind: "portal"; verifiedAt: string }>;
  terms: Omit<SyncTerms, "publishedAt"> & { publishedAt: string };
  updatedAt: string;
}

/** Why nothing is sent yet. Shown to staff per node. */
export type SkipReason = "not_syncable" | "no_published_terms" | "no_service_area" | "approval_record_missing";

export type SyncPlan = { send: true; body: SyncBody } | { send: false; reason: SkipReason };

const SYNCABLE: Record<SyncOrg["status"], SyncStatus | null> = {
  approved: "approved",
  leaving: "leaving",
  suspended: "suspended",
  withdrawn: "withdrawn",
  // Never sent: AvServ only learns of a team once the portal approves it.
  pending: null,
  rejected: null,
};

export const SKIP_LABEL: Record<SkipReason, string> = {
  not_syncable: "Not sent: pending or rejected organizations aren't sent to AvServ",
  no_published_terms: "Waiting for published team terms",
  no_service_area: "Waiting for a service area",
  approval_record_missing: "Missing the approval record",
};

export function planSync(
  org: SyncOrg,
  area: number[][][] | null,
  terms: SyncTerms | null,
  revision: number,
  now: Date,
): SyncPlan {
  const status = SYNCABLE[org.status];
  if (!status) return { send: false, reason: "not_syncable" };
  // Terms carry the team's services; without them there is nothing users
  // could accept, and AvServ's sync requires them.
  if (!terms) return { send: false, reason: "no_published_terms" };
  if (!area) return { send: false, reason: "no_service_area" };
  if (!org.approvedAt || !org.approvedByUserId) return { send: false, reason: "approval_record_missing" };

  return {
    send: true,
    body: {
      orgId: org.id,
      revision,
      status,
      leavingNoticeAt: status === "leaving" ? (org.leavingNoticeAt ?? now).toISOString() : null,
      orgType: org.orgType === "ski_patrol" ? "patrol" : "sar",
      displayName: org.name,
      approvedAt: org.approvedAt.toISOString(),
      approvedBy: `portal-user:${org.approvedByUserId}`,
      verifiedAt: org.verifiedAt?.toISOString() ?? null,
      reverifyBy: org.reverifyBy?.toISOString() ?? null,
      serviceArea: { type: "Polygon", coordinates: area },
      // The portal channel is every team's primary channel (owner decision
      // 2026-10-03), in place since approval. SMS/email/webhook come later.
      channels: [{ kind: "portal", verifiedAt: org.approvedAt.toISOString() }],
      terms: { ...terms, publishedAt: terms.publishedAt.toISOString() },
      updatedAt: now.toISOString(),
    },
  };
}
