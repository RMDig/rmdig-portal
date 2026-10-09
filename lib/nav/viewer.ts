import { eq } from "drizzle-orm";

import { hasAdminWork } from "../auth/admin-work";
import { getPlatformRoles, type PlatformRole } from "../auth/roles";
import { db } from "../db";
import { advertiserMemberships, orgMemberships } from "../db/schema";
import { featureEnabled } from "../features";

import type { NavViewer } from "./types";

// What the site header shows a signed-in viewer. One shape for the portal
// layout (read on the server) and the public pages (read through /api/nav
// after hydration, so they stay free of auth, CLAUDE.md §3.7), so the tabs
// don't change when someone moves from the dashboard to Research.
/** `roles` when the caller has already read them (the portal layout has). */
export async function navViewer(userId: string, email: string, knownRoles?: PlatformRole[]): Promise<NavViewer> {
  const [roles, teams, advertisers] = await Promise.all([
    knownRoles ?? getPlatformRoles(userId),
    db.select({ id: orgMemberships.orgId }).from(orgMemberships).where(eq(orgMemberships.userId, userId)).limit(1),
    db
      .select({ id: advertiserMemberships.advertiserId })
      .from(advertiserMemberships)
      .where(eq(advertiserMemberships.userId, userId))
      .limit(1),
  ]);
  const isStaff = roles.length > 0;
  const showAdmin = hasAdminWork(roles, {
    adsOn: featureEnabled("advertiser_portal"),
    reviewsOn: featureEnabled("restriction_review"),
  });
  return { email, showAdmin, hasMap: isStaff || teams.length > 0 || advertisers.length > 0 };
}
