import { eq } from "drizzle-orm";

import { db } from "../db";
import { userPlatformRoles } from "../db/schema";

// Platform roles are rmdig-staff capabilities (operator, SAR-org reviewer),
// separate from per-org membership roles (P1.4). Most users hold none. Fetched
// where needed (nav, route guards) rather than baked into the session, so the
// session stays a query lighter on every request.

export type PlatformRole = (typeof userPlatformRoles.role.enumValues)[number];

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
