import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "../db";
import { deletionRequests, userPlatformRoles, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendDeletionClockEmail } from "../email/send";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { CPA_DAYS, cpaDaysLeft } from "./share-log";

// The Colorado Privacy Act clock, watched daily (the deletion-clock cron)
// rather than only shown on the admin pages: a confirmed request 30 or more
// days old and not completed is a warning (Sentry + an email to every rmdig
// admin), and at 40 days it escalates to an error. It repeats every day until
// the request is marked completed.

export const WARN_DAYS = 30;
export const ESCALATE_DAYS = 40;
const DAY_MS = 86_400_000;

export interface DeletionClockSummary {
  open: number;
  escalated: number;
  emailed: number;
  emailFailed: number;
}

export async function runDeletionClock(now: Date): Promise<DeletionClockSummary> {
  const rows = await db
    .select({ id: deletionRequests.id, confirmedAt: deletionRequests.confirmedAt })
    .from(deletionRequests)
    .where(
      and(
        eq(deletionRequests.status, "confirmed"),
        lte(deletionRequests.confirmedAt, new Date(now.getTime() - WARN_DAYS * DAY_MS)),
      ),
    )
    .orderBy(asc(deletionRequests.confirmedAt));
  const summary: DeletionClockSummary = { open: rows.length, escalated: 0, emailed: 0, emailFailed: 0 };
  if (rows.length === 0) return summary;

  const items = rows.map((r) => {
    // A confirmed request always has confirmed_at (the confirm page sets both).
    const confirmedAt = r.confirmedAt!;
    return {
      requestId: r.id,
      confirmedAtIso: confirmedAt.toISOString(),
      dueIso: new Date(confirmedAt.getTime() + CPA_DAYS * DAY_MS).toISOString(),
      daysLeft: cpaDaysLeft(confirmedAt, now),
    };
  });
  const escalated = items.filter((i) => CPA_DAYS - i.daysLeft >= ESCALATE_DAYS);
  summary.escalated = escalated.length;

  // Fixed messages, so each stage is one Sentry issue rather than one per request.
  const context = { requests: items.map((i) => ({ id: i.requestId, daysLeft: i.daysLeft })) };
  if (escalated.length > 0) {
    reportProblem("deletion.clock.escalated", `CPA deletion requests ${ESCALATE_DAYS}+ days old and not completed`, context, "error");
  } else {
    reportProblem("deletion.clock.warning", `CPA deletion requests ${WARN_DAYS}+ days old and not completed`, context, "warning");
  }

  const admins = await db
    .select({ email: users.email })
    .from(userPlatformRoles)
    .innerJoin(users, eq(users.id, userPlatformRoles.userId))
    .where(eq(userPlatformRoles.role, "rmdig_admin"));
  if (admins.length === 0) {
    reportProblem("deletion.clock.no_admins", "No rmdig admin to remind about CPA deletion requests");
    return summary;
  }
  const params = { escalated: escalated.length > 0, items, queueUrl: portalUrl("/admin/deletion-requests") };
  for (const a of admins) {
    try {
      await sendDeletionClockEmail(a.email, params);
      summary.emailed++;
    } catch (err) {
      // lib/email/send has already reported it to Sentry, as has the clock.
      summary.emailFailed++;
      logger.error({ event: "deletion.clock.email_failed", err });
    }
  }
  return summary;
}
