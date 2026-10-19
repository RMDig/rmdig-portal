import { createHash } from "node:crypto";

import type { Adapter, AdapterSession } from "next-auth/adapters";

import type { SessionAuthMethod } from "../db/schema";

// Auth.js looks sessions up by the exact cookie token. This wrapper stores and
// looks up sha256(token) instead (plan 36 §3.2), so a copy of the sessions table
// can't sign anyone in. It wraps the four session methods and nothing else:
//
// - createSession stores the hash but returns the RAW token, because Auth.js
//   sets the cookie from the returned row;
// - getSessionAndUser and updateSession return the raw token they were given,
//   because Auth.js passes the session they return straight back to
//   updateSession, which would otherwise hash a hash;
// - deleteSession hashes before deleting.
//
// Deletes by user id elsewhere (password reset, OAuth link) don't touch the
// token and need nothing from this. SHA-256 because the token is high-entropy
// and random, as in lib/auth/reset-tokens.ts; bcrypt is for human passwords.

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionAdapterDeps {
  /** The signing-in browser's User-Agent, for the session list. Called inside
   *  the sign-in request; null when the browser sent none. */
  userAgent: () => Promise<string | null>;
  now?: () => Date;
}

// Kept short: it's only shown as "Safari on iPhone", and a header is unbounded.
const USER_AGENT_MAX = 200;

type RequiredSessionMethods = Required<
  Pick<Adapter, "createSession" | "getSessionAndUser" | "updateSession" | "deleteSession">
>;

function sessionMethods(base: Adapter): RequiredSessionMethods {
  const { createSession, getSessionAndUser, updateSession, deleteSession } = base;
  if (!createSession || !getSessionAndUser || !updateSession || !deleteSession) {
    throw new Error("session adapter: the base adapter lacks a session method");
  }
  return { createSession, getSessionAndUser, updateSession, deleteSession };
}

export function withHashedSessions(base: Adapter, deps: SessionAdapterDeps): Adapter {
  const m = sessionMethods(base);
  const now = deps.now ?? (() => new Date());

  return {
    ...base,

    async createSession(session) {
      const userAgent = (await deps.userAgent())?.slice(0, USER_AGENT_MAX) ?? null;
      // The credentials sign-in (lib/auth.ts jwt.encode) says it's a password;
      // Auth.js itself creates sessions only for OAuth sign-ins here.
      const authMethod: SessionAuthMethod =
        (session as AdapterSession & { authMethod?: SessionAuthMethod }).authMethod ?? "oauth";
      // Extra columns ride along in the insert; the Drizzle adapter writes the
      // object as given. authTime and createdAt take their database defaults.
      const row = await m.createSession({
        ...session,
        sessionToken: hashSessionToken(session.sessionToken),
        userAgent,
        authMethod,
      } as AdapterSession);
      return { ...row, sessionToken: session.sessionToken };
    },

    async getSessionAndUser(sessionToken) {
      const found = await m.getSessionAndUser(hashSessionToken(sessionToken));
      if (!found) return null;
      return { ...found, session: { ...found.session, sessionToken } };
    },

    async updateSession(session) {
      const row = await m.updateSession({
        ...session,
        sessionToken: hashSessionToken(session.sessionToken),
        lastSeenAt: now(),
      } as Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">);
      if (!row) return row;
      return { ...row, sessionToken: session.sessionToken };
    },

    async deleteSession(sessionToken) {
      await m.deleteSession(hashSessionToken(sessionToken));
    },
  };
}
