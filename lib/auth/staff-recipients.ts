import { eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { userPlatformRoles, users } from "../db/schema";
import type { PlatformRole } from "./roles";

/** Email addresses of rmdig staff holding any of `roles` (default: every
 *  platform role), once each. Notifications go to whoever can act on the
 *  queue: SAR approvals, ad approvals and restriction reviews are open to both
 *  admins and reviewers. */
export async function staffEmails(roles?: PlatformRole[]): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(userPlatformRoles)
    .innerJoin(users, eq(users.id, userPlatformRoles.userId))
    .where(roles ? inArray(userPlatformRoles.role, roles) : undefined);
  return [...new Set(rows.map((r) => r.email))];
}
