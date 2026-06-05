import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";

import { mapUserToAvServAccountOnLogin } from "./avserv/account-link";
import { decryptSecret } from "./auth/mfa";
import { verifySecondFactor } from "./auth/mfa-verify";
import { db } from "./db";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { env } from "./env";
import { logger } from "./logger";
import { incrementRateLimit, resetRateLimit } from "./rate-limit";

const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  // Optional second factor. Absent on the first submit (password only); present
  // on the resubmit after we signal MFA_REQUIRED. A 6-digit TOTP or a recovery code.
  totp: z.string().optional(),
});

// 5 fails / 15 min window per email — bootstrap section P1.1.
const SIGNIN_RATE_LIMIT = { limit: 5, windowSec: 15 * 60 };

// CredentialsSignin subclasses carry a `code` that propagates intact to the
// sign-in server action (unlike plain Errors, which get wrapped). The action
// reads the code to drive the two-phase MFA challenge in the UI.
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}
class MfaInvalidError extends CredentialsSignin {
  code = "mfa_invalid";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/verify-email",
    error: "/sign-in",
  },
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Trust Google's email verification — we'll set emailVerified on first
      // sign-in via the signIn callback.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          logger.warn({ event: "auth.credentials.invalid_input" });
          return null;
        }
        const { email, password, totp } = parsed.data;

        // Throttle BEFORE the user lookup so we don't leak account existence
        // through timing. Key is per-email regardless of whether the user
        // exists. 5 fails / 15 min per bootstrap section P1.1. The same window
        // also caps TOTP guessing, since the second factor runs under this key.
        const rl = await incrementRateLimit(`signin:${email}`, SIGNIN_RATE_LIMIT);
        if (!rl.allowed) {
          logger.warn({ event: "auth.credentials.rate_limited", email, attempts: rl.attempts });
          throw new Error("Too many sign-in attempts. Try again in a few minutes.");
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.passwordHash) {
          logger.info({ event: "auth.credentials.no_user_or_password", email });
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          logger.info({ event: "auth.credentials.bad_password", userId: user.id });
          return null;
        }

        if (!user.emailVerified) {
          logger.info({ event: "auth.credentials.unverified", userId: user.id });
          throw new Error("Please verify your email before signing in. Check your inbox.");
        }

        // Second factor (phase two). The password is correct; if MFA is on, the
        // user must also present a current TOTP or an unused recovery code.
        if (user.mfaEnabledAt) {
          const code = totp?.trim();
          if (!code) {
            // Password ok, code not yet supplied — tell the UI to ask for it.
            logger.info({ event: "auth.credentials.mfa_required", userId: user.id });
            throw new MfaRequiredError();
          }
          if (!user.totpSecretEncrypted) {
            // Enabled but no secret is an inconsistent state; force re-enrollment
            // rather than silently letting the user past the second factor.
            logger.error({ event: "auth.credentials.mfa_missing_secret", userId: user.id });
            throw new MfaRequiredError();
          }
          const second = await verifySecondFactor(
            user.id,
            decryptSecret(user.totpSecretEncrypted),
            code,
          );
          if (!second) {
            logger.info({ event: "auth.credentials.mfa_invalid", userId: user.id });
            throw new MfaInvalidError();
          }
        }

        // Success — clear the throttle window so this login's attempts (and the
        // MFA handshake) don't count against the next one.
        await resetRateLimit(`signin:${email}`);

        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // Database session strategy: user is the full DB row. Surface the id on
      // session.user so server-side `auth()` calls can use it directly.
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
    async signIn({ user, account }) {
      // OAuth providers (Google + later Apple) have already verified the email
      // on their side. Mark our row as verified on first sign-in.
      if (account?.type === "oauth" && user.email) {
        const [existing] = await db
          .select({ emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.email, user.email))
          .limit(1);
        if (existing && !existing.emailVerified) {
          await db
            .update(users)
            .set({ emailVerified: new Date() })
            .where(eq(users.email, user.email));
        }
      }
      return true;
    },
  },
  events: {
    async signIn({ user, account }) {
      logger.info({ event: "auth.signin", userId: user.id, provider: account?.provider });
      // Map this user to their canonical AvServ account (P-B1). Runs here, in an
      // event (not a callback), so it fires after the user row is persisted and
      // cannot gate the session. mapUser…OnLogin is itself failure-safe and
      // idempotent — a transient AvServ outage just retries on the next login.
      if (user.id) {
        await mapUserToAvServAccountOnLogin(user.id);
      }
    },
    async signOut() {
      logger.info({ event: "auth.signout" });
    },
  },
  secret: env.NEXTAUTH_SECRET,
  trustHost: true,
});

// Augment the default session type with our user.id field so consumers of
// `auth()` get it typed without casting.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
