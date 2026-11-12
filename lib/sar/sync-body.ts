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
  regionName: string | null;
  isDrill: boolean;
  /** The confirmed on-call address and when (plan 33 9.10); both or neither. */
  oncallEmail: string | null;
  oncallEmailVerifiedAt: Date | null;
  /** The check-out cap (plan 33 9.7); null: no limit. */
  maxActiveCheckouts: number | null;
  /** Open, or confirm-first (plan 33 D4, 9.8). */
  acceptanceMode: "open" | "confirm_first";
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
  serviceAreaLabels: string[];
  publicListing: PublicListing;
  channels: Array<{ kind: "portal"; verifiedAt: string } | { kind: "email"; address: string; verifiedAt: string }>;
  terms: Omit<SyncTerms, "publishedAt"> & { publishedAt: string };
  updatedAt: string;
  /** Sync revision 3, drill teams only (plan 37 §4.5). Absent for a real
   *  team, so a real team's body and AvServ's hash of it don't change. */
  drill?: true;
  /** Sync revision 2 (§5), only when the team has a cap: absent means no
   *  limit, so an uncapped team's body and its hash don't change. */
  maxActiveCheckouts?: number;
  /** Sync revision 2 (§5), only for a confirm-first team: absent means open. */
  acceptanceMode?: "confirm_first";
}

/** The team's public-directory listing (sar_team_sync.md §1; shared consent,
 *  portal plan 34 D2). Not listed until plan 34's toggle exists: consent is
 *  false and nothing else is offered yet. */
export interface PublicListing {
  consent: false;
  consentAt: null;
  websiteUrl: null;
  givingUrl: null;
  blurb: null;
  logoRef: null;
}

const NOT_LISTED: PublicListing = { consent: false, consentAt: null, websiteUrl: null, givingUrl: null, blurb: null, logoRef: null };

/** AvServ's limit on one serviceAreaLabel; the portal's regionName input is
 *  capped to it (lib/sar/schema.ts), so a label is never cut. */
export const SERVICE_AREA_LABEL_MAX = 100;

/** Why nothing is sent yet. Shown to staff per node. */
export type SkipReason =
  | "not_syncable"
  | "no_published_terms"
  | "no_service_area"
  | "approval_record_missing"
  | "drill_support_pending"
  | "settings_support_pending"
  | "email_channel_missing";

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
  drill_support_pending: "Waiting for drill support on every node",
  settings_support_pending: "Waiting for every node to support the team's check-out settings",
  email_channel_missing: "Not sent: the terms send by email, but the team has no confirmed on-call email",
};

/** Whether a team's check-out settings are other than revision 1's meaning
 *  (open, no limit): only then are they sent, and only then does the sync
 *  wait for every node to read them (sar_team_sync.md §5). */
export function hasCheckoutSettings(org: Pick<SyncOrg, "maxActiveCheckouts" | "acceptanceMode">): boolean {
  return org.maxActiveCheckouts !== null || org.acceptanceMode !== "open";
}

/** `drillSupported`: every node reports sync revision 3 (lib/avserv/sar-capabilities).
 *  Read only for a drill team; a real team never waits on it.
 *  `settingsSupported`: every node reports revision 2 (SETTINGS_SYNC_REVISION).
 *  Read only for a team with check-out settings (hasCheckoutSettings); any
 *  other team never waits on it. */
export function planSync(
  org: SyncOrg,
  area: number[][][] | null,
  terms: SyncTerms | null,
  revision: number,
  now: Date,
  drillSupported = false,
  settingsSupported = false,
): SyncPlan {
  const status = SYNCABLE[org.status];
  if (!status) return { send: false, reason: "not_syncable" };
  // Terms carry the team's services; without them there is nothing users
  // could accept, and AvServ's sync requires them.
  if (!terms) return { send: false, reason: "no_published_terms" };
  if (!area) return { send: false, reason: "no_service_area" };
  if (!org.approvedAt || !org.approvedByUserId) return { send: false, reason: "approval_record_missing" };
  // A node below revision 3 ignores `drill` and would store the team as a
  // real one, offered to real users. Never send a drill team without it.
  if (org.isDrill && !drillSupported) return { send: false, reason: "drill_support_pending" };
  // Likewise a revision 1 node would ignore the settings: bind without the
  // cap, or store a confirm-first team as open.
  if (hasCheckoutSettings(org) && !settingsSupported) return { send: false, reason: "settings_support_pending" };
  // AvServ refuses the whole PUT for a capability whose channel isn't in
  // `channels`; publishing refuses this, so reaching it is a portal bug.
  const emailChannel = org.oncallEmail && org.oncallEmailVerifiedAt ? { kind: "email" as const, address: org.oncallEmail, verifiedAt: org.oncallEmailVerifiedAt.toISOString() } : null;
  if (!emailChannel && terms.capabilities.some((c) => c.channels.includes("email"))) return { send: false, reason: "email_channel_missing" };

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
      // The team's own name for its area (AvServ serves it with the listing, so
      // only once the team consents to one).
      serviceAreaLabels: org.regionName?.trim() ? [org.regionName.trim()] : [],
      publicListing: NOT_LISTED,
      // The portal channel is every team's primary channel (owner decision
      // 2026-10-03), in place since approval; the on-call email once
      // confirmed (plan 33 9.10). SMS and webhook come later.
      channels: [{ kind: "portal", verifiedAt: org.approvedAt.toISOString() }, ...(emailChannel ? [emailChannel] : [])],
      terms: { ...terms, publishedAt: terms.publishedAt.toISOString() },
      updatedAt: now.toISOString(),
      ...(org.isDrill ? { drill: true as const } : {}),
      ...(org.maxActiveCheckouts !== null ? { maxActiveCheckouts: org.maxActiveCheckouts } : {}),
      ...(org.acceptanceMode === "confirm_first" ? { acceptanceMode: "confirm_first" as const } : {}),
    },
  };
}
