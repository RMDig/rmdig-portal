import { AD_REVIEW_ROLES, type PlatformRole } from "./roles";

// Whether /admin has anything for these roles: the same conditions that decide
// which cards the admin hub renders (app/(portal)/admin/page.tsx). The header
// shows its Admin link only then, so a Reviewer with the ad queue switched off
// doesn't get a link to an empty page (2026-10-08). Their roles are listed in
// Settings instead.
export function hasAdminWork(roles: PlatformRole[], features: { adsOn: boolean; reviewsOn: boolean }): boolean {
  if (roles.length === 0) return false;
  return (
    roles.includes("rmdig_admin") ||
    roles.includes("rmdig_sar_approver") ||
    (features.adsOn && roles.some((r) => AD_REVIEW_ROLES.includes(r))) ||
    features.reviewsOn
  );
}
