import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../db";
import { orgMemberships, sarAlertNotifications, sarIntakeMessages, sarOrgs, users } from "../db/schema";

// The SQL behind lib/sar/alert-notify.ts. Every claim is one statement, so
// exclusivity rests on Postgres, not on timing: a new claim is a unique-key
// insert (the (org, alert, kind) primary key), and a retry claim is a
// conditional UPDATE that only matches an owed row whose lease has run out.
// Each claim bumps `attempts`, and recording an outcome requires the attempts
// value the claim returned: a claimant whose lease lapsed and was taken over
// can't overwrite the newer attempt's result.

export interface NotifyKey {
  orgId: string;
  alertId: string;
  kind: string;
}

export interface Claim extends NotifyKey {
  /** This attempt's number (1 for the first), and its fencing token. */
  attempts: number;
  deliveredUserIds: string[];
}

export type NotifyStatus = (typeof sarAlertNotifications.$inferSelect)["status"];

const keyMatch = (k: NotifyKey) =>
  and(
    eq(sarAlertNotifications.orgId, k.orgId),
    eq(sarAlertNotifications.alertId, k.alertId),
    eq(sarAlertNotifications.kind, k.kind),
  );

const claimed = {
  orgId: sarAlertNotifications.orgId,
  alertId: sarAlertNotifications.alertId,
  kind: sarAlertNotifications.kind,
  attempts: sarAlertNotifications.attempts,
  deliveredUserIds: sarAlertNotifications.deliveredUserIds,
};

/** The first copy of an alert or update claims its email. Null when another
 *  copy already holds the claim. */
export async function claimNew(key: NotifyKey, messageId: string, now: Date, leaseMs: number): Promise<Claim | null> {
  const [row] = await db
    .insert(sarAlertNotifications)
    .values({
      ...key,
      messageId,
      status: "pending",
      attempts: 1,
      leasedUntil: new Date(now.getTime() + leaseMs),
      lastAttemptAt: now,
    })
    .onConflictDoNothing()
    .returning(claimed);
  return row ?? null;
}

/** Takes over an owed email (pending or failed) whose last attempt's lease
 *  has run out. Null when it is sent, given up, or still being attempted. */
export async function claimRetry(key: NotifyKey, now: Date, leaseMs: number): Promise<Claim | null> {
  const [row] = await db
    .update(sarAlertNotifications)
    .set({
      attempts: sql`${sarAlertNotifications.attempts} + 1`,
      leasedUntil: new Date(now.getTime() + leaseMs),
      lastAttemptAt: now,
    })
    .where(
      and(
        keyMatch(key),
        inArray(sarAlertNotifications.status, ["pending", "failed"]),
        or(isNull(sarAlertNotifications.leasedUntil), lt(sarAlertNotifications.leasedUntil, now)),
      ),
    )
    .returning(claimed);
  return row ?? null;
}

/** Records an attempt's outcome and releases the lease. False when a later
 *  attempt has taken the row over (this one's result is then stale). */
export async function recordAttempt(
  claim: Claim,
  outcome: { status: NotifyStatus; deliveredUserIds: string[]; lastError: string | null; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(sarAlertNotifications)
    .set({
      status: outcome.status,
      deliveredUserIds: outcome.deliveredUserIds,
      lastError: outcome.lastError,
      leasedUntil: null,
      sentAt: outcome.status === "sent" ? outcome.now : null,
    })
    .where(and(keyMatch(claim), eq(sarAlertNotifications.attempts, claim.attempts)))
    .returning({ attempts: sarAlertNotifications.attempts });
  return rows.length > 0;
}

/** What the email says: the team's name, and whether a Send Help came from a
 *  user in the area (the claiming message's capability). */
export async function notifyContext(key: NotifyKey): Promise<{ teamName: string; capability: string | null } | null> {
  const [row] = await db
    .select({ teamName: sarOrgs.name, capability: sarIntakeMessages.capability })
    .from(sarAlertNotifications)
    .innerJoin(sarIntakeMessages, eq(sarIntakeMessages.messageId, sarAlertNotifications.messageId))
    .innerJoin(sarOrgs, eq(sarOrgs.id, sarAlertNotifications.orgId))
    .where(keyMatch(key))
    .limit(1);
  return row ?? null;
}

/** True once the team has the alert's all-clear or retraction. */
export async function alertEnded(orgId: string, alertId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sarIntakeMessages.messageId })
    .from(sarIntakeMessages)
    .where(
      and(
        eq(sarIntakeMessages.orgId, orgId),
        eq(sarIntakeMessages.alertId, alertId),
        inArray(sarIntakeMessages.kind, ["all_clear", "disregard"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Only the roles that can open the alerts page and act on it (owner
 *  decision 2026-10-06): a responder couldn't follow the email's link. */
export async function recipients(orgId: string): Promise<Array<{ userId: string; email: string }>> {
  return db
    .select({ userId: users.id, email: users.email })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, orgId), inArray(orgMemberships.role, ["admin", "dispatcher"])));
}

/** Owed emails no attempt currently holds, oldest first. */
export async function dueForRetry(now: Date, limit: number): Promise<NotifyKey[]> {
  return db
    .select({ orgId: sarAlertNotifications.orgId, alertId: sarAlertNotifications.alertId, kind: sarAlertNotifications.kind })
    .from(sarAlertNotifications)
    .where(
      and(
        inArray(sarAlertNotifications.status, ["pending", "failed"]),
        or(isNull(sarAlertNotifications.leasedUntil), lt(sarAlertNotifications.leasedUntil, now)),
      ),
    )
    .orderBy(asc(sarAlertNotifications.createdAt))
    .limit(limit);
}
