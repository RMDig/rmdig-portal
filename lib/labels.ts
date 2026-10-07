// Plain words for the portal's status and role codes, in one place, so a
// team's status reads the same on the dashboard, its pages, the map and in
// staff tools, and no page shows a raw code like "pending" or "upheld".
// Keyed by the database enums, so a new value doesn't compile without a label.

import type {
  advertiserRole,
  advertiserStatus,
  orgRole,
  restrictionReviewAction,
  restrictionReviewStatus,
  sarOrgStatus,
} from "./db/schema";

type Code<E extends { enumValues: readonly string[] }> = E["enumValues"][number];

export type TeamRole = Code<typeof orgRole>;
export type AdvertiserRole = Code<typeof advertiserRole>;

export const TEAM_ROLE_LABEL: Record<Code<typeof orgRole>, string> = {
  admin: "Admin",
  dispatcher: "Dispatcher",
  responder: "Responder",
};

/** "You're invited as an admin": the role with its article. */
export const TEAM_ROLE_PHRASE: Record<Code<typeof orgRole>, string> = {
  admin: "an admin",
  dispatcher: "a dispatcher",
  responder: "a responder",
};

export const TEAM_STATUS_LABEL: Record<Code<typeof sarOrgStatus>, string> = {
  pending: "Under review",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
  leaving: "Leaving the program",
  withdrawn: "Withdrawn",
};

export const ADVERTISER_ROLE_LABEL: Record<Code<typeof advertiserRole>, string> = {
  admin: "Admin",
  editor: "Editor",
};

export const ADVERTISER_ROLE_PHRASE: Record<Code<typeof advertiserRole>, string> = {
  admin: "an admin",
  editor: "an editor",
};

export const ADVERTISER_STATUS_LABEL: Record<Code<typeof advertiserStatus>, string> = {
  active: "Active",
  suspended: "Suspended",
};

export const RESTRICTION_REVIEW_STATUS_LABEL: Record<Code<typeof restrictionReviewStatus>, string> = {
  open: "Open",
  upheld: "Upheld",
  lifted: "Lifted",
  closed: "Closed (already lifted)",
};

export const RESTRICTION_REVIEW_ACTION_LABEL: Record<Code<typeof restrictionReviewAction>, string> = {
  submitted: "Requested",
  upheld: "Upheld",
  lifted: "Lifted",
  closed: "Closed (already lifted)",
};
