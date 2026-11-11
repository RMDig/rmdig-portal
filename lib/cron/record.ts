import { eq } from "drizzle-orm";

import { db } from "../db";
import { cronRuns } from "../db/schema";
import { CRON_JOBS, type CronJob } from "./jobs";
import { owesRun } from "./schedule";

/** Record that `job` just finished successfully, for the cron watch. */
export async function recordCronSuccess(job: CronJob, now: Date = new Date()): Promise<void> {
  await db
    .insert(cronRuns)
    .values({ job, lastSuccessAt: now })
    .onConflictDoUpdate({ target: cronRuns.job, set: { lastSuccessAt: now } });
}

/** Whether the cron watch missed its last run. Every other job asks after its
 *  own run, so the watch is checked several times a day without a Sentry
 *  monitor (the free plan's one may be unavailable; owner, 2026-11-11). False
 *  until the watch has run once and made its row. */
export async function cronWatchMissed(now: Date = new Date()): Promise<boolean> {
  const [row] = await db.select().from(cronRuns).where(eq(cronRuns.job, "cron_watch")).limit(1);
  return row ? owesRun(row, CRON_JOBS.cron_watch.schedule, now) : false;
}
