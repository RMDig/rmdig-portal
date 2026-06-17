import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { advertiserMemberships } from "../db/schema";

// Per-advertiser membership roles, distinct from platform roles (lib/auth/roles.ts)
// and SAR org roles (lib/auth/org-roles.ts). A user holds at most one role row per
// advertiser. Fetched where needed (nav, route guards, server-action re-checks)
// rather than baked into the session — a user's advertiser set is unbounded and
// changes without re-login. Server actions MUST re-check with these helpers; never
// trust a layout to gate a write (docs/plans/30 §9, mirroring doc 06 §Permissions).

export type AdvertiserRole = (typeof advertiserMemberships.role.enumValues)[number];

export interface AdvertiserMembership {
  advertiserId: string;
  role: AdvertiserRole;
}

/** Every advertiser the user belongs to, with their role. Powers the dashboard. */
export async function getAdvertiserMemberships(
  userId: string,
): Promise<AdvertiserMembership[]> {
  return db
    .select({
      advertiserId: advertiserMemberships.advertiserId,
      role: advertiserMemberships.role,
    })
    .from(advertiserMemberships)
    .where(eq(advertiserMemberships.userId, userId));
}

/** The user's role in one advertiser account, or null if they aren't a member. */
export async function getAdvertiserRole(
  userId: string,
  advertiserId: string,
): Promise<AdvertiserRole | null> {
  const [row] = await db
    .select({ role: advertiserMemberships.role })
    .from(advertiserMemberships)
    .where(
      and(
        eq(advertiserMemberships.userId, userId),
        eq(advertiserMemberships.advertiserId, advertiserId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/** True if the user administers the advertiser — manage members/billing and the
 *  account's settings. The gate for advertiser-admin-only routes and actions. */
export async function canManageAdvertiser(
  userId: string,
  advertiserId: string,
): Promise<boolean> {
  return (await getAdvertiserRole(userId, advertiserId)) === "admin";
}

/** True if the user belongs to the advertiser in any role (admin or editor) —
 *  the gate for authoring creatives under it. */
export async function isAdvertiserMember(
  userId: string,
  advertiserId: string,
): Promise<boolean> {
  return (await getAdvertiserRole(userId, advertiserId)) !== null;
}
