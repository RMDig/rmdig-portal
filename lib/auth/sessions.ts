import { and, eq, ne } from "drizzle-orm";

import { db } from "../db";
import { sessions } from "../db/schema";
import { currentSessionTokenHash } from "./recent-auth";

// The signed-in browsers of one account, for /settings/sessions (plan 36 §3.3).
// Rows are addressed by `sessions.id`; the token hash never leaves the server.

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  userAgent: string | null;
  current: boolean;
}

/** The id of the session this request is signed in with, or null. */
export async function currentSessionId(userId: string): Promise<string | null> {
  const tokenHash = await currentSessionTokenHash();
  if (!tokenHash) return null;
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.sessionToken, tokenHash), eq(sessions.userId, userId)))
    .limit(1);
  return row?.id ?? null;
}

/** Live sessions, this browser first, then most recently active. */
export async function listSessions(userId: string, now: Date = new Date()): Promise<SessionSummary[]> {
  const current = await currentSessionId(userId);
  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      userAgent: sessions.userAgent,
      expires: sessions.expires,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  const active = (s: { createdAt: Date; lastSeenAt: Date | null }) => (s.lastSeenAt ?? s.createdAt).getTime();
  return rows
    .filter((r) => r.expires > now)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      userAgent: r.userAgent,
      current: r.id === current,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || active(b) - active(a));
}

type Executor = Pick<typeof db, "delete">;

/** Sign one of `userId`'s sessions out. False when it isn't theirs (or is gone). */
export async function revokeSession(executor: Executor, userId: string, sessionId: string): Promise<boolean> {
  const deleted = await executor
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
    .returning({ id: sessions.id });
  return deleted.length > 0;
}

/** Sign out every session of `userId` except `keepSessionId`. Returns how many. */
export async function revokeOtherSessions(
  executor: Executor,
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const deleted = await executor
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });
  return deleted.length;
}

/** After a credential change: sign out every session but this one. With no
 *  current session to keep (no cookie reached the action), sign out all of
 *  them; the safe direction, since the user can sign straight back in. */
export async function signOutOtherSessions(
  executor: Executor,
  userId: string,
  keepSessionId: string | null,
): Promise<number> {
  if (keepSessionId) return revokeOtherSessions(executor, userId, keepSessionId);
  const deleted = await executor
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return deleted.length;
}
