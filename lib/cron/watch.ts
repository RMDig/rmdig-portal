import { db } from "../db";
import { cronRuns } from "../db/schema";
import { staffEmails } from "../auth/staff-recipients";
import { sendCronWatchStaffEmail } from "../email/send";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { CRON_JOBS, type CronJob } from "./jobs";
import { lastDueRun, owesRun } from "./schedule";

// The cron watch (owner, 2026-11-11). Sentry's free plan includes one cron
// monitor, and more need a paid plan, so the portal's other jobs don't have
// monitors of their own. Each job's success is recorded (lib/cron/record.ts),
// and once a day this checks that every job succeeded at or after its last
// scheduled time. A late job is a Sentry issue, an email to rmdig admins, and
// a failed check-in on the watch's own monitor (portal-cron-watch). A failed
// run is already reported by lib/cron/run.ts; this catches runs that never
// happen. If the watch itself stops, its monitor reports a missed check-in,
// and so does the next job to run (lib/cron/record.ts), so the watch is
// covered even before its monitor has an alert.

export interface CronRunRow {
  job: string;
  lastSuccessAt: Date | null;
  watchedSince: Date;
}

export interface LateJob {
  job: CronJob;
  path: string;
  dueAt: Date;
  lastSuccessAt: Date | null;
}

/** Jobs that haven't succeeded since the run they owe. A job the watch first
 *  saw after that run isn't late yet. The watch doesn't check itself. */
export function lateJobs(rows: CronRunRow[], now: Date): LateJob[] {
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const late: LateJob[] = [];
  for (const [job, { path, schedule }] of Object.entries(CRON_JOBS) as Array<[CronJob, (typeof CRON_JOBS)[CronJob]]>) {
    if (job === "cron_watch") continue;
    const row = byJob.get(job);
    if (!row) throw new Error(`lateJobs: no cron_runs row for ${job}`);
    if (owesRun(row, schedule, now)) late.push({ job, path, dueAt: lastDueRun(schedule, now), lastSuccessAt: row.lastSuccessAt });
  }
  return late;
}

export interface CronWatchSummary {
  watched: number;
  late: string[];
  emailed: number;
  emailFailed: number;
}

export async function runCronWatch(now: Date = new Date()): Promise<CronWatchSummary> {
  // A job the watch hasn't seen yet starts being watched now.
  const jobs = Object.keys(CRON_JOBS) as CronJob[];
  await db
    .insert(cronRuns)
    .values(jobs.map((job) => ({ job, watchedSince: now })))
    .onConflictDoNothing();
  const rows = await db.select().from(cronRuns);
  const late = lateJobs(rows, now);
  const summary: CronWatchSummary = { watched: jobs.length - 1, late: late.map((l) => l.job), emailed: 0, emailFailed: 0 };
  if (late.length === 0) return summary;

  reportProblem("cron.watch.late", "A scheduled job didn't run", { jobs: summary.late.join(",") });
  const admins = await staffEmails(["rmdig_admin"]);
  if (admins.length === 0) {
    reportProblem("cron.watch.no_admins", "No rmdig admin to tell about a scheduled job that didn't run", { jobs: summary.late.join(",") });
    return summary;
  }
  const params = { jobs: late.map((l) => ({ path: l.path, dueAt: l.dueAt.toISOString(), lastSuccessAt: l.lastSuccessAt?.toISOString() ?? null })) };
  for (const to of admins) {
    try {
      await sendCronWatchStaffEmail(to, params);
      summary.emailed++;
    } catch (err) {
      // deliver() has already reported it to Sentry.
      summary.emailFailed++;
      logger.error({ event: "cron.watch.email_failed", to, err });
    }
  }
  return summary;
}
