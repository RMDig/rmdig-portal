import { randomUUID } from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import { encode as defaultJwtEncode } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { mapUserToAvServAccountOnLogin } from "./avserv/account-link";
import { authorizeCredentials } from "./auth/credentials-authorize";
import { markOAuthUserVerified, secureOAuthEmailLink } from "./auth/oauth-link";
import { db } from "./db";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { env } from "./env";
import { logger } from "./logger";

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
      // Trust Google's email verification and link into an existing row with
      // the same email (owner decision D1). Safe only together with the signIn
      // callback below, which strips an unverified row before the link.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Throttling, password and second-factor checks: lib/auth/credentials-authorize.ts.
      authorize: authorizeCredentials,
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
      // OAuth providers (Google + later Apple) have verified the email on their
      // side. Before the adapter links this sign-in into an existing row with
      // the same email, make that row safe to hand over: an unverified row loses
      // its password and sessions and becomes verified (beta blocker B1, see
      // secureOAuthEmailLink). A first-time OAuth user has no row yet, so this
      // is a no-op for them (events.linkAccount verifies their new row).
      if (account?.type === "oauth" && user.email) {
        await secureOAuthEmailLink(user.email);
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
    async linkAccount({ user, account }) {
      // A first-time OAuth user's row is created unverified; the provider has
      // just proved the address. See markOAuthUserVerified.
      if (account.type === "oauth" && user.id) {
        await markOAuthUserVerified(user.id);
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
