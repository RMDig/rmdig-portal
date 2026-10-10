"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { AuthError, CredentialsSignin } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/lib/auth";
import { finishSignUp } from "@/lib/auth/email-first-signup";
import { generateResetToken, hashResetToken } from "@/lib/auth/reset-tokens";
import { generateVerificationToken } from "@/lib/auth/verification-tokens";
import { nextQuery, safeReturnTo } from "@/lib/auth/return-to";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { featureEnabled } from "@/lib/features";
import { passwordResetTokens, sessions, users, verificationTokens } from "@/lib/db/schema";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { portalUrl } from "@/lib/email/links";

// ----- Schemas -----

// Sign-up dropdown ("What brings you to AvAI?"). A pure routing hint — grants
// nothing (SAR approval stays manual per CLAUDE.md §0).
const intentSchema = z.enum(["explorer", "sar", "advertiser"]).default("explorer");

// Email first (beta plan D1a): no password until the emailed link is opened.
const signUpSchema = z.object({
  email: z.string().email().toLowerCase(),
  intent: intentSchema,
});

// The first password, chosen on the page the verification link opens. Same
// rules and retype-to-confirm check as a reset (the client can't be trusted to
// enforce the match, and a typo'd password locks a new user out).
const newPasswordFields = {
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200, "Password is too long"),
  confirmPassword: z.string(),
};
const passwordsMatch = {
  check: (data: { password: string; confirmPassword: string }) => data.password === data.confirmPassword,
  message: { message: "Passwords don't match", path: ["confirmPassword"] },
};

const finishSignUpSchema = z
  .object({ email: z.string().email().toLowerCase(), token: z.string().min(1), ...newPasswordFields })
  .refine(passwordsMatch.check, passwordsMatch.message);

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

// 5 sign-ups/hour per client IP. Sign-up is an unauthenticated write path
// (§7) that bcrypt-hashes, inserts a row, and sends a verification email on
// every call — unthrottled, it's an account-spam and email-fan-out vector.
// 5/hr still covers a NAT'd household or club signing up the same evening.
const SIGNUP_IP_RATE_LIMIT = { limit: 5, windowSec: 60 * 60 };
// Re-sent verification links per address: enough for a lost email, not a
// way to mail-bomb someone through our sender.
const VERIFY_RESEND_RATE_LIMIT = { limit: 3, windowSec: 60 * 60 };

/** Replace any earlier link for this address with a fresh one and email it.
 *  `next` (a safe same-site path) rides along so verification can return the
 *  user to where they were headed, e.g. an invite. Throws if the send fails. */
async function issueVerification(email: string, next: string | null): Promise<void> {
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email));
  // Only the hash is stored; the plaintext exists only in the emailed link.
  const { token, tokenHash, expires } = generateVerificationToken();
  await db.insert(verificationTokens).values({ identifier: email, token: tokenHash, expires });
  // Opens the page where the password is chosen (email-first sign-up).
  const verifyUrl = portalUrl(`/sign-up/finish?token=${token}&email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  await sendVerificationEmail(email, verifyUrl);
}

/** Re-send a verification link to an existing, unverified account. Rate
 *  limited per address. Never changes the account (in particular never its
 *  password: a stranger re-signing up with someone's address must not end up
 *  owning the account once its owner clicks the link). Returns nothing that
 *  reveals whether the address has an account. */
async function resendIfUnverified(email: string, next: string | null): Promise<void> {
  const [user] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user || user.emailVerified) return;
  const rl = await incrementRateLimit(`verify-resend:${email}`, VERIFY_RESEND_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "verify.resend_rate_limited", userId: user.id, attempts: rl.attempts });
    return;
  }
  try {
    await issueVerification(email, next);
    logger.info({ event: "verify.resent", userId: user.id });
  } catch (err) {
    // Neutral to the caller (it can't reveal the account exists), loud here.
    logger.error({ event: "verify.resend_failed", userId: user.id, err });
  }
}


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

  const { email, intent } = parsed.data;
  const next = safeReturnTo(formData.get("next"));

  const ip = await clientIp();
  const rl = await incrementRateLimit(`signup-ip:${ip}`, SIGNUP_IP_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "signup.ip_rate_limited", ip, attempts: rl.attempts });
    return { ok: false, error: "Too many sign-ups from this network. Try again later." };
  }

  // Don't leak existence — same response whether the email is new or duplicate.
  // The legitimate-owner case gets a real verification email; the attacker
  // probing for accounts sees the same neutral message.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    // An unverified address signing up again gets a fresh link; a verified
    // one gets nothing. Same answer either way.
    logger.info({ event: "signup.duplicate", email });
    await resendIfUnverified(email, next);
    return { ok: true };
  }

  // No password yet: it is set when the link is used (finishSignUpAction).
  const [user] = await db
    .insert(users)
    .values({ email, signupIntent: intent })
    .returning({ id: users.id });

  if (!user) {
    logger.error({ event: "signup.insert_returned_empty", email });
    return { ok: false, error: "Something went wrong creating your account. Try again." };
  }

  try {
    await issueVerification(email, next);
  } catch (err) {
    // The account exists; the user can ask for a new link on the "Check your
    // email" page. Surface the failure rather than pretending it worked.
    logger.error({ event: "signup.email_send_failed", userId: user.id, err });
    return {
      ok: false,
      error:
        "We created your account but couldn't send the verification email. In a moment, use \"Send a new link\" on the Check your email page.",
    };
  }

  logger.info({ event: "signup.success", userId: user.id });
  return { ok: true };
}

// ----- Finish sign-up (the page the verification link opens) -----

export async function finishSignUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = finishSignUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email, token, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = await finishSignUp({ email, token, passwordHash });
  if (!userId) {
    logger.info({ event: "signup.finish.invalid_link", email });
    return {
      ok: false,
      error: "This link has expired or was already used. Send yourself a new one.",
    };
  }
  logger.info({ event: "signup.finish.success", userId });
  return { ok: true };
}

// ----- Re-send a verification link -----

const resendSchema = z.object({ email: z.string().email().toLowerCase() });

export async function resendVerificationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = resendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Enter the email you signed up with.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const ip = await clientIp();
  const rl = await incrementRateLimit(`verify-resend-ip:${ip}`, SIGNUP_IP_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "verify.resend_ip_rate_limited", ip, attempts: rl.attempts });
    return { ok: false, error: "Too many requests from this network. Try again later." };
  }
  await resendIfUnverified(parsed.data.email, safeReturnTo(formData.get("next")));
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
    // The totp key is OMITTED (not passed as undefined) when no code was
    // submitted: next-auth serializes these options through URLSearchParams,
    // which stringifies undefined into the literal "undefined" — authorize
    // then saw a truthy "code", verified it, and every first-phase MFA
    // sign-in surfaced as "that code didn't match" instead of the challenge.
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      ...(parsed.data.totp ? { totp: parsed.data.totp } : {}),
      redirectTo: safeReturnTo(formData.get("next")) ?? "/dashboard",
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
      if (err.code === "rate_limited") {
        return { ok: false, error: "Too many sign-in attempts. Try again in a few minutes." };
      }
      if (err.code === "email_unverified") {
        return {
          ok: false,
          error:
            "Please verify your email before signing in. Check your inbox, or use \"Didn't get your verification email?\" below for a new link.",
        };
      }
      // code "credentials" — authorize returned null (bad email/password).
      return { ok: false, error: "Invalid email or password." };
    }
    // Any other AuthError is a failure on our side (authorize threw, the
    // database didn't answer): say so rather than blame the password.
    if (err instanceof AuthError) {
      logger.error({ event: "auth.signin.failed", err });
      return { ok: false, error: "Couldn't sign you in right now. Try again in a moment." };
    }
    // signIn() rethrows a NEXT_REDIRECT to trigger the redirect. Don't swallow.
    throw err;
  }
}

// ----- Sign in (Google OAuth) -----

export async function signInGoogleAction(formData: FormData): Promise<void> {
  await signIn("google", { redirectTo: safeReturnTo(formData.get("next")) ?? "/dashboard" });
}

// "Continue with Google" on the sign-up page. Google creates the account, so
// the intent dropdown can't be stored on it; it routes the first landing
// instead, straight to the matching onboarding form. Only a routing hint.
export async function signUpGoogleAction(formData: FormData): Promise<void> {
  const intent = intentSchema.catch("explorer").parse(formData.get("intent") ?? undefined);
  const landing =
    intent === "sar"
      ? "/sar/new"
      : intent === "advertiser" && featureEnabled("advertiser_portal")
        ? "/advertiser/new"
        : "/dashboard";
  await signIn("google", { redirectTo: safeReturnTo(formData.get("next")) ?? landing });
}

// ----- Sign out -----

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}

// Sign out, then sign in again and come back to `next`: for a page that needs
// a different account, such as an invitation issued to another email.
export async function signOutAndContinueAction(formData: FormData): Promise<void> {
  await signOut({ redirectTo: `/sign-in${nextQuery(safeReturnTo(formData.get("next")))}` });
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
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Any account can get a link, including a Google-only one with no password
  // yet (beta plan D1b): the link proves the inbox the same way Google does.
  if (!user) {
    logger.info({ event: "pwreset.request.no_eligible_user", email });
    return neutral;
  }

  const { token, tokenHash, expires } = generateResetToken();

  // One live token per user: drop any prior ones before issuing a new one.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expires });
  const resetUrl = portalUrl(`/reset-password?token=${token}`);

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
  .object({ token: z.string().min(1), ...newPasswordFields })
  .refine(passwordsMatch.check, passwordsMatch.message);

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
