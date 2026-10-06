import { randomUUID } from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import { encode as defaultJwtEncode } from "next-auth/jwt";
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

// Database-session lifetime (30d). Shared between the session config and the
// credentials encode override below so the manually-created session row and the
// adapter's own sessions expire on the same clock.
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// Hoisted so the credentials encode override (below) can call createSession on
// the same adapter instance NextAuth uses for everything else.
const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter,
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE,
    updateAge: 24 * 60 * 60,
  },
  // Why this exists: the Credentials provider never goes through the adapter's
  // createSession, so under `strategy: "database"` a credentials login would set
  // a session cookie pointing at NO sessions row — every request after the first
  // then fails auth(). The fix (canonical for Auth.js v5): intercept jwt.encode,
  // which credentials login DOES call to produce the cookie value, and instead
  // mint a real database session, returning its token as the cookie. NextAuth
  // still owns the cookie itself (name, Secure prefix, flags), so we avoid the
  // cookie-handling pitfalls of setting it by hand. OAuth never hits this branch
  // — under database strategy it creates adapter sessions directly, so encode is
  // only invoked for the credentials flow (flagged via the jwt callback below).
  jwt: {
    async encode(params) {
      if (params.token?.credentials) {
        const userId = params.token.sub;
        if (!userId) {
          throw new Error("credentials session encode: token.sub (user id) is missing");
        }
        if (!adapter.createSession) {
          throw new Error("credentials session encode: adapter has no createSession");
        }
        const sessionToken = randomUUID();
        const session = await adapter.createSession({
          sessionToken,
          userId,
          expires: new Date(Date.now() + SESSION_MAX_AGE * 1000),
        });
        if (!session) {
          throw new Error("credentials session encode: createSession returned nothing");
        }
        // This token becomes the cookie value; database-strategy auth() resolves
        // it via adapter.getSessionAndUser on subsequent requests.
        return sessionToken;
      }
      return defaultJwtEncode(params);
    },
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
          throw new Error(
            "Please verify your email before signing in. Check your inbox, or use \"Didn't get your verification email?\" below for a new link.",
          );
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
    async jwt({ token, account, user }) {
      // Mark the credentials flow so the encode override mints a DB session for
      // it. Also pin token.sub to the user id (encode reads it as the owner of
      // the session row). OAuth doesn't reach encode, so this flag is harmless
      // there. See the jwt.encode comment above for the full rationale.
      if (account?.provider === "credentials") {
        token.credentials = true;
        if (user?.id) token.sub = user.id;
      }
      return token;
    },
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

// `credentials` flag set by the jwt callback and read by the encode override to
// route the credentials login through database-session creation.
declare module "next-auth/jwt" {
  interface JWT {
    credentials?: boolean;
  }
}
