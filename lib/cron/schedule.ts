// The two schedule shapes the portal's jobs use, and when a run is owed.
// Daily "M H * * *" jobs keep the 90-minute margin of the Hobby plan's "some
// time within the hour"; every-N-minutes "*/N * * * *" jobs (Vercel Pro,
// plan 33 9.11) get a margin of two runs, at least five minutes, so one slow
// or skipped run isn't called late but a stopped job is.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
export const DAILY_MARGIN_MINUTES = 90;

export type Schedule = { kind: "daily"; minute: number; hour: number } | { kind: "every"; minutes: number };

/** Parse a job's crontab. Throws on any other shape, so a job the watch
 *  can't judge fails its test instead of going unwatched. */
export function parseSchedule(schedule: string): Schedule {
  const parts = schedule.split(" ");
  if (parts.length !== 5 || parts.slice(2).some((p) => p !== "*")) throw new Error(`parseSchedule: unsupported schedule: ${schedule}`);
  const [minute, hour] = parts as [string, string];
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const m = Number(minute);
    const h = Number(hour);
    if (m < 60 && h < 24) return { kind: "daily", minute: m, hour: h };
  }
  const every = hour === "*" ? (minute === "*" ? 1 : /^\*\/\d+$/.test(minute) ? Number(minute.slice(2)) : NaN) : NaN;
  // A step that divides the hour, so runs fall at the same minutes every hour.
  if (Number.isInteger(every) && every > 0 && 60 % every === 0) return { kind: "every", minutes: every };
  throw new Error(`parseSchedule: unsupported schedule: ${schedule}`);
}

/** How late a run may be before it counts as missed (the watch, and each
 *  job's Sentry monitor). */
export function marginMinutes(schedule: string): number {
  const s = parseSchedule(schedule);
  return s.kind === "daily" ? DAILY_MARGIN_MINUTES : Math.max(5, 2 * s.minutes);
}

/** The latest scheduled run whose margin has passed by `now`: the run the
 *  job should have made by now. */
export function lastDueRun(schedule: string, now: Date): Date {
  const s = parseSchedule(schedule);
  const cutoff = now.getTime() - marginMinutes(schedule) * MINUTE_MS;
  if (s.kind === "every") {
    const step = s.minutes * MINUTE_MS;
    return new Date(Math.floor(cutoff / step) * step);
  }
  const due = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hour, s.minute);
  return new Date(due > cutoff ? due - DAY_MS : due);
}

/** Whether a job owes a run: it hasn't succeeded since its last due run, and
 *  the watch knew of it before then (a job added today isn't late). */
export function owesRun(row: { lastSuccessAt: Date | null; watchedSince: Date }, schedule: string, now: Date): boolean {
  const seen = Math.max(row.lastSuccessAt?.getTime() ?? 0, row.watchedSince.getTime());
  return seen < lastDueRun(schedule, now).getTime();
}
