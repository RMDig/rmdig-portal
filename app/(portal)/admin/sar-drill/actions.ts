"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { generateResetToken } from "@/lib/auth/reset-tokens";
import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { orgMembershipLog, orgMemberships, passwordResetTokens, sarOrgs, users } from "@/lib/db/schema";
import { portalUrl } from "@/lib/email/links";
import { sendPasswordResetEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { drillLoginSchema } from "@/lib/sar/drill";

// Create a drill login (plan 37 §4.2), for rmdig_admin only: a new account
// marked drill, a member of one drill team, emailed a link to set its
// password. Not an invitation: accepting one adds an account that already
// exists, and an account's drill flag can only be set when it's created
// (migration 0036). So an address that already has an account is refused, and
// a real account is never turned into a drill one.
//
// The link is the ordinary password-reset link (60 minutes). Using it sets
// the password and verifies the address; after that, "Forgot password" on the
// address issues a new one. Two-factor is enrolled at first sign-in, as for
// anyone (MFA_ENFORCEMENT=all).

export type DrillLoginResult =
  | { ok: true; email: string; emailed: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const IN_USE = "An account already uses this address. Choose another drill address.";

// Thrown inside the transaction to roll it back with a known reason.
class DrillLoginRefused extends Error {}

export async function createDrillLoginAction(orgId: string, _prev: DrillLoginResult | null, formData: FormData): Promise<DrillLoginResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const adminId = actor.userId;
  if (!(await hasPlatformRole(adminId, "rmdig_admin"))) {
    logger.warn({ event: "sar.drill.login_forbidden", userId: adminId, orgId });
    return { ok: false, error: "Only rmdig admins can create drill logins." };
  }

  const parsed = drillLoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { email, role } = parsed.data;

  const [org] = await db.select({ isDrill: sarOrgs.isDrill, status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org?.isDrill) return { ok: false, error: "That drill team couldn't be found." };
  if (org.status === "rejected" || org.status === "withdrawn") {
    return { ok: false, error: `This drill team is ${org.status}, so it takes no new logins.` };
  }

  const { token, tokenHash, expires } = generateResetToken();
  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new DrillLoginRefused(IN_USE);
      const [user] = await tx.insert(users).values({ email, isDrill: true }).returning({ id: users.id });
      if (!user) throw new Error("users insert returned no row");
      await tx.insert(orgMemberships).values({ orgId, userId: user.id, role, invitedByUserId: adminId });
      await tx.insert(orgMembershipLog).values({ orgId, action: "joined", subjectUserId: user.id, subjectEmail: email, toRole: role, actorUserId: adminId });
      await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expires });
      return user.id;
    });
  } catch (err) {
    if (err instanceof DrillLoginRefused) return { ok: false, error: err.message, fieldErrors: { email: [err.message] } };
    // Another request took the address between the read and the insert.
    if (isUniqueViolation(err)) return { ok: false, error: IN_USE, fieldErrors: { email: [IN_USE] } };
    logger.error({ event: "sar.drill.login_failed", userId: adminId, orgId, err });
    return { ok: false, error: "Couldn't create the drill login. Try again in a moment." };
  }
  logger.info({ event: "sar.drill.login_created", userId: adminId, orgId, drillUserId: userId, role });

  // The login exists either way: the account is the record. A failed email is
  // loud here and said on the page; "Forgot password" on the address sends a
  // new link.
  let emailed = true;
  try {
    await sendPasswordResetEmail(email, portalUrl(`/reset-password?token=${token}`));
  } catch (err) {
    emailed = false;
    logger.error({ event: "sar.drill.login_email_failed", userId: adminId, orgId, drillUserId: userId, err });
  }
  revalidatePath("/admin/sar-drill");
  return { ok: true, email, emailed };
}
