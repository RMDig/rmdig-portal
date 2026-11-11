import { MONITOR_CHECKIN_MARGIN_MINUTES } from "./jobs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The latest scheduled time of a daily "M H * * *" job whose margin has
 *  passed by `now`: the run the job should have made by now. */
export function lastDueRun(schedule: string, now: Date): Date {
  const [minute, hour] = schedule.split(" ").map(Number);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) throw new Error(`lastDueRun: not a daily schedule: ${schedule}`);
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  if (due.getTime() + MONITOR_CHECKIN_MARGIN_MINUTES * 60_000 > now.getTime()) return new Date(due.getTime() - DAY_MS);
  return due;
}

/** Whether a job owes a run: it hasn't succeeded since its last due run, and
 *  the watch knew of it before then (a job added today isn't late). */
export function owesRun(row: { lastSuccessAt: Date | null; watchedSince: Date }, schedule: string, now: Date): boolean {
  const seen = Math.max(row.lastSuccessAt?.getTime() ?? 0, row.watchedSince.getTime());
  return seen < lastDueRun(schedule, now).getTime();
}
