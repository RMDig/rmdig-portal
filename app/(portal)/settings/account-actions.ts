"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

// ----- Display name -----

const displayNameSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(100, "That's too long"),
});

export async function updateDisplayNameAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = displayNameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted field.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  await db
    .update(users)
    .set({ displayName: parsed.data.displayName })
    .where(eq(users.id, session.user.id));

  logger.info({ event: "account.display_name.updated", userId: session.user.id });
  return { ok: true };
}

// ----- Password change -----

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(200, "Password is too long"),
    confirmPassword: z.string(),
  })
  // Same retype-to-confirm contract as sign-up (see (auth)/actions.ts).
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// Authenticated, but still a credential operation — throttle per user to blunt
// online guessing of the current password.
const CHANGE_PW_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };

export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const rl = await incrementRateLimit(`changepw:${userId}`, CHANGE_PW_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "account.password.rate_limited", userId, attempts: rl.attempts });
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.passwordHash) {
    // OAuth-only account — no password to change. Setting one for OAuth users is
    // a separate, deliberate flow (out of scope here).
    return {
      ok: false,
      error: "Your account signs in with Google, so there's no password to change.",
    };
  }

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    logger.info({ event: "account.password.bad_current", userId });
    return { ok: false, error: "Your current password is incorrect." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

  // Sessions are intentionally left intact: the user proved possession of the
  // current password, so this isn't a compromise-recovery flow (that's the
  // reset path, which does burn sessions). Their other devices stay signed in.
  logger.info({ event: "account.password.changed", userId });
  return { ok: true };
}
