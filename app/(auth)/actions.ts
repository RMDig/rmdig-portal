"use server";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, verificationTokens } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// ----- Schemas -----

const signUpSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200, "Password is too long"),
});

const signInSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

// ----- Action result type -----

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

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
      redirectTo: "/dashboard",
    });
    return { ok: true };
  } catch (err) {
    // Auth.js v5 throws AuthError subclasses on credentials failures. Surface
    // a clean message; never leak internals.
    if (err instanceof AuthError) {
      // Specific messages our authorize() throws come through as the .message
      // of CredentialsSignin / CallbackRouteError.
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
