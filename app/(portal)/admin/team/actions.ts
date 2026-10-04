"use server";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  platformRoleInvitations,
  platformRoleLog,
  userPlatformRoles,
  users,
} from "@/lib/db/schema";
import { sendPlatformInviteEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { generateInviteToken } from "@/lib/sar/invitations";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// Staff management (/admin/team). Granting or revoking a platform role is the
// highest-privilege mutation in the portal, so beyond the rmdig_admin session
// requirement every grant/revoke demands the ACTOR'S password again (operator
// decision 2026-07-26) — a hijacked session alone can't mint admins. Every
// transition lands in the append-only platform_role_log.

export type TeamActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | null;

// Throttle re-auth attempts so this surface can't be used to brute-force the
// admin's password (same budget as the change-password action).
const REAUTH_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };

// Returns an error string, or null when the password checks out. Fails loud
// for OAuth-only accounts — password re-auth needs a password to exist.
async function verifyActorPassword(userId: string, password: string): Promise<string | null> {
  const rate = await incrementRateLimit(`reauth:${userId}`, REAUTH_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "admin.team.reauth_rate_limited", userId });
    return "Too many password attempts. Try again later.";
  }

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.passwordHash) {
    return "Your account signs in with Google, so there's no password to confirm with. Set a password in Settings first.";
  }
  if (!(await bcrypt.compare(password, row.passwordHash))) {
    logger.warn({ event: "admin.team.reauth_failed", userId });
    return "Incorrect password.";
  }
  return null;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(["rmdig_admin", "rmdig_reviewer"]),
  currentPassword: z.string().min(1, "Enter your password to confirm"),
});

export async function createPlatformInviteAction(
  _prev: TeamActionResult,
  formData: FormData,
): Promise<TeamActionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const actorId = actor.userId;
  if (!(await hasPlatformRole(actorId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can invite staff." };
  }

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email, role, currentPassword } = parsed.data;

  const reauthError = await verifyActorPassword(actorId, currentPassword);
  if (reauthError) {
    return { ok: false, error: reauthError };
  }

  // Refuse duplicates loudly rather than silently minting parallel invites.
  const [holder] = await db
    .select({ userId: userPlatformRoles.userId })
    .from(userPlatformRoles)
    .innerJoin(users, eq(users.id, userPlatformRoles.userId))
    .where(and(eq(users.email, email), eq(userPlatformRoles.role, role)))
    .limit(1);
  if (holder) {
    return { ok: false, error: "That person already holds this role." };
  }
  const [pending] = await db
    .select({ id: platformRoleInvitations.id })
    .from(platformRoleInvitations)
    .where(
      and(
        eq(platformRoleInvitations.email, email),
        eq(platformRoleInvitations.role, role),
      ),
    )
    .limit(1);
  if (pending) {
    return {
      ok: false,
      error: "An invitation for that email and role already exists. Cancel it first to re-send.",
    };
  }

  const { token, tokenHash, expires } = generateInviteToken();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(platformRoleInvitations).values({
        email,
        role,
        tokenHash,
        expiresAt: expires,
        createdByUserId: actorId,
      });
      await tx.insert(platformRoleLog).values({
        action: "invite_created",
        role,
        targetEmail: email,
        actorUserId: actorId,
      });
    });
  } catch (err) {
    logger.error({ event: "admin.team.invite_insert_failed", email, role, err });
    return { ok: false, error: "Couldn't create the invitation. Try again in a moment." };
  }

  const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    await sendPlatformInviteEmail(email, {
      inviteUrl: `${baseUrl}/admin-invite/${token}`,
      roleLabel: PLATFORM_ROLE_LABEL[role],
    });
  } catch (err) {
    // The invite row is the source of truth, but without the email the link is
    // unreachable — surface it so the admin cancels and retries (fail loud).
    logger.error({ event: "admin.team.invite_email_failed", email, err });
    return {
      ok: false,
      error: "Invitation recorded, but the email failed to send. Cancel it and try again.",
    };
  }

  logger.info({ event: "admin.team.invite_created", email, role, actorId });
  revalidatePath("/admin/team");
  return { ok: true };
}

const cancelSchema = z.object({ inviteId: z.string().uuid() });

export async function cancelPlatformInviteAction(
  _prev: TeamActionResult,
  formData: FormData,
): Promise<TeamActionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const actorId = actor.userId;
  if (!(await hasPlatformRole(actorId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can manage invitations." };
  }
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Invalid invitation." };
  }

  const deleted = await db
    .delete(platformRoleInvitations)
    .where(eq(platformRoleInvitations.id, parsed.data.inviteId))
    .returning({ email: platformRoleInvitations.email, role: platformRoleInvitations.role });
  const row = deleted[0];
  if (!row) {
    return { ok: false, error: "That invitation no longer exists." };
  }

  await db.insert(platformRoleLog).values({
    action: "invite_cancelled",
    role: row.role,
    targetEmail: row.email,
    actorUserId: actorId,
  });
  logger.info({ event: "admin.team.invite_cancelled", email: row.email, actorId });
  revalidatePath("/admin/team");
  return { ok: true };
}

const revokeSchema = z.object({
  targetUserId: z.string().uuid(),
  role: z.enum(["rmdig_admin", "rmdig_reviewer"]),
  currentPassword: z.string().min(1, "Enter your password to confirm"),
});

export async function revokePlatformRoleAction(
  _prev: TeamActionResult,
  formData: FormData,
): Promise<TeamActionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const actorId = actor.userId;
  if (!(await hasPlatformRole(actorId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can revoke roles." };
  }
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { targetUserId, role, currentPassword } = parsed.data;

  const reauthError = await verifyActorPassword(actorId, currentPassword);
  if (reauthError) {
    return { ok: false, error: reauthError };
  }

  // Never orphan the platform: the last administrator is irrevocable (the
  // break-glass path for a truly stuck state is scripts/seed-admin.ts).
  if (role === "rmdig_admin") {
    const admins = await db
      .select({ userId: userPlatformRoles.userId })
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.role, "rmdig_admin"));
    if (admins.length <= 1) {
      return { ok: false, error: "You can't revoke the last platform administrator." };
    }
  }

  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  const deleted = await db
    .delete(userPlatformRoles)
    .where(
      and(eq(userPlatformRoles.userId, targetUserId), eq(userPlatformRoles.role, role)),
    )
    .returning({ userId: userPlatformRoles.userId });
  if (deleted.length === 0) {
    return { ok: false, error: "That user doesn't hold this role." };
  }

  await db.insert(platformRoleLog).values({
    action: "revoked",
    role,
    targetEmail: target?.email ?? "(deleted user)",
    targetUserId,
    actorUserId: actorId,
  });
  logger.info({ event: "admin.team.role_revoked", targetUserId, role, actorId });
  revalidatePath("/admin/team");
  return { ok: true };
}
