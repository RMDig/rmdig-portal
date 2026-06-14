import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { orgMemberships } from "../db/schema";

// Per-SAR-org membership roles, distinct from platform roles (lib/auth/roles.ts).
// A user holds at most one role row per org. Fetched where needed (nav, route
// guards, server-action re-checks) rather than baked into the session — a user's
// org set is unbounded and changes without re-login. Server actions MUST re-check
// with these helpers; never trust a layout to gate a write (doc 06 §Permissions).

export type OrgRole = (typeof orgMemberships.role.enumValues)[number];

export interface OrgMembership {
  orgId: string;
  role: OrgRole;
}

/** Every org the user belongs to, with their role. Powers the SAR nav section. */
export async function getOrgMemberships(userId: string): Promise<OrgMembership[]> {
  return db
    .select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, userId));
}

/** The user's role in one org, or null if they aren't a member. */
export async function getOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)))
    .limit(1);
  return row?.role ?? null;
}

/** True if the user administers the org — manage settings, invite members, and
 *  act on its workspace. The gate for org-admin-only routes and actions. */
export async function canManageOrg(userId: string, orgId: string): Promise<boolean> {
  return (await getOrgRole(userId, orgId)) === "admin";
}

/** True if the user can respond for the org. Roles are additive (doc 01), so any
 *  membership — responder, dispatcher, or admin — can respond. */
export async function canRespondForOrg(userId: string, orgId: string): Promise<boolean> {
  return (await getOrgRole(userId, orgId)) !== null;
}
