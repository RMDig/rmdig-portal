import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "../db";
import {
  advertiserInvitations,
  deletionRequests,
  orgInvitations,
  passwordResetTokens,
  platformRoleInvitations,
  rateLimits,
  sessions,
  verificationTokens,
} from "../db/schema";
import { MAX_RATE_LIMIT_WINDOW_SEC } from "../rate-limit";

// Rows that are useless once they expire would otherwise stay until the
// account is deleted: expired sessions, password-reset and email-verification
// tokens, deletion requests nobody confirmed, invitations nobody accepted, and
// spent rate-limit windows. They hold emails, user-agents and hashed identifiers, so the Privacy Policy
// can only promise they go "after they expire" if something deletes them.
//
// Tokens and unconfirmed deletion requests get a grace period so an old link
// still answers "expired", not "invalid". A confirmed deletion request is the
// record that a CPA request was handled, and an accepted invitation is the
// record of who invited whom; neither is touched here.

export const GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ExpiredRowsSummary {
  sessions: number;
  passwordResetTokens: number;
  verificationTokens: number;
  unconfirmedDeletionRequests: number;
  unacceptedInvitations: number;
  rateLimits: number;
}

export async function deleteExpiredRows(now: Date): Promise<ExpiredRowsSummary> {
  const graceCut = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
  // A window that started before this can no longer count anything.
  const rateCut = new Date(now.getTime() - Math.max(GRACE_DAYS * DAY_MS, MAX_RATE_LIMIT_WINDOW_SEC * 1000));

  return db.transaction(async (tx) => {
    // A session is dead at expiry (Auth.js signs it out); no link to answer.
    const s = await tx.delete(sessions).where(lt(sessions.expires, now)).returning({ id: sessions.id });
    const r = await tx
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expires, graceCut))
      .returning({ id: passwordResetTokens.id });
    const v = await tx
      .delete(verificationTokens)
      .where(lt(verificationTokens.expires, graceCut))
      .returning({ identifier: verificationTokens.identifier });
    const d = await tx
      .delete(deletionRequests)
      .where(and(eq(deletionRequests.status, "pending_confirmation"), lt(deletionRequests.tokenExpiresAt, graceCut)))
      .returning({ id: deletionRequests.id });
    // Team, staff and advertiser invitations: Admin → Team shows an expired
    // one as "expired" for the grace period, then it goes.
    const io = await tx
      .delete(orgInvitations)
      .where(and(isNull(orgInvitations.acceptedAt), lt(orgInvitations.expiresAt, graceCut)))
      .returning({ id: orgInvitations.id });
    const ip = await tx
      .delete(platformRoleInvitations)
      .where(and(isNull(platformRoleInvitations.acceptedAt), lt(platformRoleInvitations.expiresAt, graceCut)))
      .returning({ id: platformRoleInvitations.id });
    const ia = await tx
      .delete(advertiserInvitations)
      .where(and(isNull(advertiserInvitations.acceptedAt), lt(advertiserInvitations.expiresAt, graceCut)))
      .returning({ id: advertiserInvitations.id });
    const l = await tx.delete(rateLimits).where(lt(rateLimits.windowStart, rateCut)).returning({ key: rateLimits.key });
    return {
      sessions: s.length,
      passwordResetTokens: r.length,
      verificationTokens: v.length,
      unconfirmedDeletionRequests: d.length,
      unacceptedInvitations: io.length + ip.length + ia.length,
      rateLimits: l.length,
    };
  });
}
