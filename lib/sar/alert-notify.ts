import { sendSarAlertNotifyEmail } from "../email/send";
import { portalUrl } from "../email/links";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import {
  alertEnded,
  type Claim,
  claimNew,
  claimRetry,
  dueForRetry,
  type NotifyKey,
  notifyContext,
  recipients,
  recordAttempt,
} from "./alert-notify-store";
import type { IntakePayload } from "./intake";

// The team email for an alert and its updates (AvServ sar_portal_intake.md).
// Members hear about alerts and their resolution; never about drills or
// duplicate notices (the alerts page shows those).
//
// Both AvServ nodes deliver every message, and the email must go once. The
// first copy claims it (lib/sar/alert-notify-store.ts) and sends; a send that
// fails, or never finishes, stays owed and is retried by the other node's
// copy when its lease is up, or by the daily sar-alert-notify cron. Each
// member is emailed at most once per alert and kind. After MAX_ATTEMPTS the
// email is given up loudly (Sentry). The alert itself is stored and shown on
// the alerts page whatever happens here.

export const MAX_ATTEMPTS = 4;
// Longer than a function can run (Vercel's limit is 300 s), so a live attempt
// is never taken over; one that died is retried once its lease is up.
export const LEASE_MS = 6 * 60_000;
const RETRY_BATCH = 100;

type EmailKind = "overdue" | "send_help" | "all_clear" | "disregard";
const EMAIL_KINDS: readonly string[] = ["overdue", "send_help", "all_clear", "disregard"] satisfies EmailKind[];

/** Whether this message emails the team at all. */
export function emailsTeam(payload: Pick<IntakePayload, "drill" | "kind">): boolean {
  return !payload.drill && EMAIL_KINDS.includes(payload.kind);
}

export type AttemptOutcome = "sent" | "failed" | "abandoned" | "superseded" | "stale";

/** Called by the intake handler once the message is stored. Never throws:
 *  the message is stored, so the answer to AvServ is 200 whatever happens to
 *  the email; failures are reported and left owed for the retry. */
export async function notifyOnIntake(payload: IntakePayload, now: Date = new Date()): Promise<void> {
  if (!emailsTeam(payload)) return;
  const key: NotifyKey = { orgId: payload.teamId, alertId: payload.alertId, kind: payload.kind };
  try {
    // The other node's copy of a message whose email failed (or stalled)
    // retries it straight away rather than waiting for the cron.
    const claim = (await claimNew(key, payload.messageId, now, LEASE_MS)) ?? (await claimRetry(key, now, LEASE_MS));
    if (!claim) return;
    await attempt(claim, now);
  } catch (err) {
    // A database failure mid-attempt: the claim's lease runs out and the cron
    // (or the other copy) retries it.
    reportError("sar.notify.attempt_crashed", err, { ...key, messageId: payload.messageId });
  }
}

export interface RetrySummary {
  due: number;
  sent: number;
  failed: number;
  abandoned: number;
  superseded: number;
  skipped: number;
}

/** The cron's sweep over every owed email. Throws only if it can't read the
 *  queue; a crash on one email is reported and the sweep moves on. */
export async function retryAlertNotifications(now: Date): Promise<RetrySummary> {
  const due = await dueForRetry(now, RETRY_BATCH);
  const summary: RetrySummary = { due: due.length, sent: 0, failed: 0, abandoned: 0, superseded: 0, skipped: 0 };
  for (const key of due) {
    try {
      const claim = await claimRetry(key, now, LEASE_MS);
      if (!claim) {
        summary.skipped++;
        continue;
      }
      const outcome = await attempt(claim, now);
      if (outcome === "stale") summary.skipped++;
      else summary[outcome]++;
    } catch (err) {
      summary.failed++;
      reportError("sar.notify.attempt_crashed", err, { ...key });
    }
  }
  return summary;
}

async function attempt(claim: Claim, now: Date): Promise<AttemptOutcome> {
  const key: NotifyKey = { orgId: claim.orgId, alertId: claim.alertId, kind: claim.kind };
  const context = { ...key, attempt: claim.attempts };

  // A late retry of an alert the team has since had the all-clear (or
  // retraction) for would read as a new emergency: send the update only.
  if (claim.attempts > 1 && (claim.kind === "overdue" || claim.kind === "send_help") && (await alertEnded(claim.orgId, claim.alertId))) {
    await record(claim, "superseded", claim.deliveredUserIds, "the alert ended before the email could be sent", now);
    logger.warn({ event: "sar.notify.superseded", ...context });
    return "superseded";
  }

  const [ctx, members] = await Promise.all([notifyContext(key), recipients(claim.orgId)]);
  if (!ctx) throw new Error("notification row has no stored message or team");
  if (members.length === 0) {
    reportProblem("sar.notify.no_recipients", "A SAR alert email has no admin or dispatcher to go to", context);
    return (await record(claim, "abandoned", claim.deliveredUserIds, "no admin or dispatcher to email", now)) ? "abandoned" : "stale";
  }

  const delivered = new Set(claim.deliveredUserIds);
  const todo = members.filter((m) => !delivered.has(m.userId));
  const alertsUrl = portalUrl(`/sar/${claim.orgId}/alerts`);
  // Each failure is already logged and sent to Sentry by lib/email/send.
  const results = await Promise.allSettled(
    todo.map((m) =>
      sendSarAlertNotifyEmail(m.email, {
        teamName: ctx.teamName,
        kind: claim.kind as EmailKind,
        fromAreaUser: ctx.capability === "send_help_area",
        alertsUrl,
      }),
    ),
  );
  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") delivered.add(todo[i]!.userId);
    else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  });

  if (failures.length === 0) {
    const ok = await record(claim, "sent", [...delivered], null, now);
    if (ok) logger.info({ event: "sar.notify.sent", ...context, recipients: todo.length });
    return ok ? "sent" : "stale";
  }

  const lastError = `${failures.length} of ${todo.length} emails failed: ${failures[0]!.slice(0, 200)}`;
  if (claim.attempts >= MAX_ATTEMPTS) {
    const ok = await record(claim, "abandoned", [...delivered], lastError, now);
    reportProblem("sar.notify.abandoned", `Gave up emailing a SAR team about an alert after ${claim.attempts} attempts`, {
      ...context,
      undelivered: failures.length,
      lastError,
    });
    return ok ? "abandoned" : "stale";
  }
  const ok = await record(claim, "failed", [...delivered], lastError, now);
  logger.error({ event: "sar.notify.failed", ...context, undelivered: failures.length, lastError });
  return ok ? "failed" : "stale";
}

async function record(claim: Claim, status: "sent" | "failed" | "abandoned" | "superseded", deliveredUserIds: string[], lastError: string | null, now: Date): Promise<boolean> {
  const ok = await recordAttempt(claim, { status, deliveredUserIds, lastError, now });
  // Another attempt took the row over while this one ran (its lease lapsed):
  // that attempt's result stands. Loud, because a lease is meant to outlast
  // any attempt.
  if (!ok) reportProblem("sar.notify.lease_lost", "A SAR alert email attempt outlived its lease", { ...claim, status }, "warning");
  return ok;
}
