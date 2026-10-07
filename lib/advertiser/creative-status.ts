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

/** The label an advertiser sees. Staff asking for changes puts a creative back
 *  in `draft` with a note, which must not read the same as a draft that was
 *  never submitted. */
export function creativeStatusLabel(status: string, reviewNote: string | null | undefined): string {
  if (status === "draft" && reviewNote) return "Changes requested";
  return CREATIVE_STATUS_LABEL[status] ?? status;
}
