// Human labels for the ad_creative_status enum (docs/plans/30 §5). Shared by the
// advertiser-facing creatives list/detail and the operator approval queue so the
// two never drift. Kept free of any server-only import so client components can use
// it too.
export const CREATIVE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Under review",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
};
