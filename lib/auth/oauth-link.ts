import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { sessions, users, verificationTokens } from "../db/schema";
import { logger } from "../logger";

/**
 * Runs on every OAuth sign-in, from the Auth.js `signIn` callback — before the
 * adapter links the provider account to a row with the same email
 * (`allowDangerousEmailAccountLinking`) and before it creates the new session.
 *
 * The provider has proved the caller controls `email`. If our row for that
 * address is not yet verified, nothing on it was ever proved to belong to that
 * person — in particular its password may have been set by a stranger who
 * signed up with the address first (beta blocker B1: the stranger's password
 * would start working the moment the row became verified). So, atomically:
 *
 *   - the password is cleared and the row marked verified, in one guarded
 *     statement (the row becomes Google-only, like any OAuth account; adding a
 *     password to an OAuth-only account is not offered today),
 *   - every existing session for the row is deleted,
 *   - every pending email-verification link for the address is deleted.
 *
 * A verified row is left alone: its password was set by someone who proved the
 * address, so a verified credentials user who later adds Google keeps it.
 * No row (a first-time OAuth user) is a no-op; the adapter creates it next.
 *
 * `email` is matched exactly, the same way the adapter's getUserByEmail finds
 * the row it links into.
 */
export async function secureOAuthEmailLink(email: string): Promise<void> {
  await db.transaction(async (tx) => {
    // The guarded UPDATE is the claim: it only touches a row that is still
    // unverified, so a concurrent verification can't be raced into clearing a
    // password that was just proved.
    const [row] = await tx
      .update(users)
      .set({ passwordHash: null, emailVerified: new Date() })
      .where(and(eq(users.email, email), isNull(users.emailVerified)))
      .returning({ id: users.id });
    if (!row) return;

    await tx.delete(sessions).where(eq(sessions.userId, row.id));
    await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, email));

    // Expected for a real owner who signed up but never clicked the link; also
    // exactly what the pre-hijack looks like. Worth a trail either way: an
    // owner who had set a password now signs in with Google only.
    logger.warn({ event: "auth.oauth_link.unverified_row_secured", userId: row.id });
  });
}

/**
 * Runs from the Auth.js `linkAccount` event, after the adapter has linked an
 * OAuth account to a row and before the sign-in completes. For a first-time
 * OAuth user the adapter creates the row with `emailVerified: null`; the
 * provider has proved the address, so record that now. Without this the row
 * stayed unverified until a second sign-in, and checks that need a verified
 * address (AvServ account mapping in `events.signIn`, SAR and advertiser
 * applications) refused a brand-new Google user.
 *
 * Only ever reached for a row that has no password of ours: a pre-existing
 * unverified row was already handled by secureOAuthEmailLink, which verified
 * it, so the guard makes this a no-op there.
 */
export async function markOAuthUserVerified(userId: string): Promise<void> {
  const updated = await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerified)))
    .returning({ id: users.id });
  if (updated.length > 0) {
    logger.info({ event: "auth.oauth_link.new_user_verified", userId });
  }
}
