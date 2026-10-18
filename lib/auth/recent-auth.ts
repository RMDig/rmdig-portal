import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "../db";
import { sessions } from "../db/schema";
import { logger } from "../logger";
import { hashSessionToken } from "./session-adapter";

// "Recent login" for the actions an abuser holding a signed-in browser must not
// reach (plan 36 §3.4, rule 1): revoking a phone, the App Lock reset code, MFA
// changes, the security-events view, the notice toggle, signing other sessions
// out. Each checks the CURRENT session's auth_time, which is set when the
// session is created and again by re-authentication, never by a refresh.

/** Owner decision S-D2 (2026-10-18). */
export const RECENT_AUTH_MAX_AGE_SEC = 10 * 60;

// auth_time comes from the database clock, the check from the app's: allow the
// app to run a little behind rather than ask someone who just signed in again.
const CLOCK_SKEW_MS = 60_000;

// Auth.js's session cookie, with the __Secure- prefix it uses over HTTPS.
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

export function isRecentAuth(
  authTime: Date,
  now: Date,
  maxAgeSec: number = RECENT_AUTH_MAX_AGE_SEC,
): boolean {
  const age = now.getTime() - authTime.getTime();
  return age > -CLOCK_SKEW_MS && age <= maxAgeSec * 1000;
}

async function currentSessionTokenHash(): Promise<string | null> {
  const store = await cookies();
  for (const name of SESSION_COOKIES) {
    const value = store.get(name)?.value;
    if (value) return hashSessionToken(value);
  }
  return null;
}

export type RecentAuthResult = { ok: true; sessionId: string } | { ok: false; reauth: true };

/** Whether `userId`'s current session signed in recently enough. Anything
 *  short of a matching, recent session row asks for re-authentication. */
export async function requireRecentAuth(
  userId: string,
  opts: { maxAgeSec?: number; now?: Date } = {},
): Promise<RecentAuthResult> {
  const tokenHash = await currentSessionTokenHash();
  if (!tokenHash) {
    logger.warn({ event: "auth.recent.no_cookie", userId });
    return { ok: false, reauth: true };
  }
  const [row] = await db
    .select({ id: sessions.id, authTime: sessions.authTime })
    .from(sessions)
    .where(and(eq(sessions.sessionToken, tokenHash), eq(sessions.userId, userId)))
    .limit(1);
  if (!row) {
    // auth() found a session for this user a moment ago, so a missing row
    // means it was revoked in between, or the cookie belongs to someone else.
    logger.warn({ event: "auth.recent.no_session_row", userId });
    return { ok: false, reauth: true };
  }
  const now = opts.now ?? new Date();
  return isRecentAuth(row.authTime, now, opts.maxAgeSec)
    ? { ok: true, sessionId: row.id }
    : { ok: false, reauth: true };
}

/** Record that the current session just re-authenticated. False when there is
 *  no current session row for `userId` to update. */
export async function markRecentAuth(userId: string): Promise<boolean> {
  const tokenHash = await currentSessionTokenHash();
  if (!tokenHash) return false;
  const updated = await db
    .update(sessions)
    .set({ authTime: new Date() })
    .where(and(eq(sessions.sessionToken, tokenHash), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
