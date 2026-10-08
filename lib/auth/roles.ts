import { eq } from "drizzle-orm";

import { db } from "../db";
import { userPlatformRoles } from "../db/schema";

// Platform roles are rmdig-staff capabilities (operator, SAR approver, ad reviewer),
// separate from per-org membership roles (P1.4). Most users hold none. Fetched
// where needed (nav, route guards) rather than baked into the session, so the
// session stays a query lighter on every request.

export type PlatformRole = (typeof userPlatformRoles.role.enumValues)[number];

// Human-readable names for UI display. The enum values (rmdig_admin, …) are
// storage identifiers, not copy — never render them raw.
export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  rmdig_admin: "Platform Administrator",
  rmdig_reviewer: "Reviewer",
  rmdig_sar_approver: "SAR Approver",
};

// Who does what (CLAUDE.md §0). Every SAR org decision (approve, reject,
// request changes, the lifecycle steps, re-verification) and the approvals
// queue itself belong to rmdig_sar_approver alone, a role only an rmdig_admin
// grants. The ad-approval queue is rmdig_admin and rmdig_reviewer.
export const SAR_APPROVER_ROLE = "rmdig_sar_approver" satisfies PlatformRole;
export const AD_REVIEW_ROLES: PlatformRole[] = ["rmdig_admin", "rmdig_reviewer"];

export async function getPlatformRoles(userId: string): Promise<PlatformRole[]> {
  const rows = await db
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.userId, userId));
  return rows.map((r) => r.role);
}

export async function hasPlatformRole(userId: string, role: PlatformRole): Promise<boolean> {
  const roles = await getPlatformRoles(userId);
  return roles.includes(role);
}

/** True for any rmdig-staff role — the gate for the /admin area. */
export async function isPlatformStaff(userId: string): Promise<boolean> {
  const roles = await getPlatformRoles(userId);
  return roles.length > 0;
}

/** The gate for the SAR approvals queue and every decision in it. */
export async function isSarApprover(userId: string): Promise<boolean> {
  return hasPlatformRole(userId, SAR_APPROVER_ROLE);
}

/** The gate for the ad-approvals queue. */
export async function canReviewAds(userId: string): Promise<boolean> {
  const roles = await getPlatformRoles(userId);
  return roles.some((r) => AD_REVIEW_ROLES.includes(r));
}
