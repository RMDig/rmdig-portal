import { and, eq } from "drizzle-orm";

import { evaluateMfaGate, type MfaGate } from "@/lib/auth/mfa-enforcement";
import { getPlatformRoles, type PlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { orgMemberships, users } from "@/lib/db/schema";
import { env } from "@/lib/env";

// The MFA verdict for a signed-in user. The portal layout redirects on
// "required", but Next renders a page alongside its layout and server actions
// never pass through it, so anything that writes or acts on a view (an audit
// row, a POST to AvServ) checks this itself.
export async function userMfaGate(userId: string): Promise<{ gate: MfaGate; roles: PlatformRole[] }> {
  const [roles, [row], orgAdminRows] = await Promise.all([
    getPlatformRoles(userId),
    db.select({ mfaEnabledAt: users.mfaEnabledAt, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ orgId: orgMemberships.orgId })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.role, "admin")))
      .limit(1),
  ]);
  const gate = evaluateMfaGate({
    enforcement: env.MFA_ENFORCEMENT,
    mfaEnabled: !!row?.mfaEnabledAt,
    isStaff: roles.length > 0,
    isOrgAdmin: orgAdminRows.length > 0,
    hasPassword: !!row?.passwordHash,
  });
  return { gate, roles };
}
