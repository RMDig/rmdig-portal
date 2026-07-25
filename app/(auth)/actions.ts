"use server";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { AuthError, CredentialsSignin } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/lib/auth";
import { generateResetToken, hashResetToken } from "@/lib/auth/reset-tokens";
import { db } from "@/lib/db";
import { passwordResetTokens, sessions, users, verificationTokens } from "@/lib/db/schema";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// ----- Schemas -----

const signUpSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(200, "Password is too long"),
    confirmPassword: z.string(),
  })
  // Server-side twin of the retype-to-confirm UX — the client can't be trusted
  // to enforce the match, and a typo'd password locks the user out of a brand
  // new account until they discover password reset.
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const signInSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

// ----- Action result type -----

export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[] | undefined>;
      // Set when the password was correct but a second factor is needed (or was
      // wrong). The sign-in form reveals the TOTP field and resubmits.
      mfaRequired?: boolean;
      // Distinguishes "we're asking for the code" (neutral prompt) from "the
      // code you typed was wrong" (error styling). Only meaningful alongside
      // mfaRequired.
      mfaInvalid?: boolean;
    };

// ----- Sign up -----

export async function signUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password } = parsed.data;

  // Don't leak existence — same response whether the email is new or duplicate.
  // The legitimate-owner case gets a real verification email; the attacker
  // probing for accounts sees the same neutral message.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    logger.info({ event: "signup.duplicate", email });
    return { ok: true };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .returning({ id: users.id });

  if (!user) {
    logger.error({ event: "signup.insert_returned_empty", email });
    return { ok: false, error: "Something went wrong creating your account. Try again." };
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(verificationTokens).values({
    identifier: email,
    token,
    expires,
  });

  const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
  const verifyUrl = `${baseUrl}/api/verify?token=${token}&email=${encodeURIComponent(email)}`;

  try {
    await sendVerificationEmail(email, verifyUrl);
  } catch (err) {
    // The user row and token are written — they can request a re-send. Surface
    // the failure rather than pretending it succeeded.
    logger.error({ event: "signup.email_send_failed", userId: user.id, err });
    return {
      ok: false,
      error:
        "We created your account but couldn't send the verification email. Try signing up again in a moment.",
    };
  }

  logger.info({ event: "signup.success", userId: user.id });
  return { ok: true };
}

// ----- Sign in (credentials) -----

export async function signInCredentialsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      totp: parsed.data.totp,
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (err) {
    // MFA signals come through as CredentialsSignin subclasses with a `code`
    // (these propagate intact, unlike plain Errors). Check them first.
    if (err instanceof CredentialsSignin) {
      if (err.code === "mfa_required") {
        return {
          ok: false,
          mfaRequired: true,
          error: "Please enter your MFA code from your authenticator app.",
        };
      }
      if (err.code === "mfa_invalid") {
        return {
          ok: false,
          mfaRequired: true,
          mfaInvalid: true,
          error: "That code didn't match. Try again, or use a recovery code.",
        };
      }
      // code "credentials" — authorize returned null (bad email/password).
      return { ok: false, error: "Invalid email or password." };
    }
    // Other AuthErrors: our plain-Error throws (verify-email, too-many-attempts)
    // arrive wrapped; surface those messages, else a generic one.
    if (err instanceof AuthError) {
      const friendly =
        err.message.includes("verify your email") || err.message.includes("Too many")
          ? err.message
          : "Invalid email or password.";
      return { ok: false, error: friendly };
    }
    // signIn() rethrows a NEXT_REDIRECT to trigger the redirect. Don't swallow.
    throw err;
  }
}

// ----- Sign in (Google OAuth) -----

export async function signInGoogleAction(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

// ----- Sign out -----

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}

// ----- Password reset: request -----

const requestResetSchema = z.object({
  email: z.string().email().toLowerCase(),
});

// Throttle reset requests per email so this can't be used to flood someone's
// inbox or as an oracle. 5 / 15 min mirrors the sign-in limit.
const RESET_REQUEST_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };

export async function requestPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = requestResetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email } = parsed.data;

  // Everything past validation returns the SAME neutral success — whether the
  // email exists, is OAuth-only, or is rate-limited — so this never reveals
  // whether an account exists.
  const neutral: ActionResult = { ok: true };

  const rl = await incrementRateLimit(`pwreset:${email}`, RESET_REQUEST_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "pwreset.request.rate_limited", email, attempts: rl.attempts });
    return neutral;
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Only credentials users (those with a password) can reset one. OAuth-only
  // accounts have a null hash and nothing to reset — silently no-op, neutrally.
  if (!user || !user.passwordHash) {
    logger.info({ event: "pwreset.request.no_eligible_user", email });
    return neutral;
  }

  const { token, tokenHash, expires } = generateResetToken();

  // One live token per user: drop any prior ones before issuing a new one.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expires });

  const baseUrl = env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail(email, resetUrl);
    logger.info({ event: "pwreset.request.sent", userId: user.id });
  } catch (err) {
    // Don't leak the failure through the response (that would expose existence);
    // log it so we can see delivery problems. The user can request again.
    logger.error({ event: "pwreset.request.email_failed", userId: user.id, err });
  }

  return neutral;
}

// ----- Password reset: complete -----

const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(200, "Password is too long"),
    confirmPassword: z.string(),
  })
  // Same retype-to-confirm contract as sign-up (see signUpSchema).
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export async function resetPasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { token, password } = parsed.data;

  const tokenHash = hashResetToken(token);
  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expires, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    logger.info({ event: "pwreset.complete.invalid_or_expired" });
    return {
      ok: false,
      error: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Set the new password and mark the email verified — completing a reset proves
  // control of the inbox, so an unverified credentials user becomes verified.
  await db
    .update(users)
    .set({ passwordHash, emailVerified: new Date() })
    .where(eq(users.id, row.userId));

  // Burn every reset token for this user (single-use + clears any siblings)...
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));
  // ...and invalidate all existing sessions so a stolen session can't outlive
  // the password it was opened under. The user re-authenticates with the new one.
  await db.delete(sessions).where(eq(sessions.userId, row.userId));

  logger.info({ event: "pwreset.complete.success", userId: row.userId });
  return { ok: true };
}
